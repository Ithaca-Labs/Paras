// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// Polymarket DepositWallet `Batch` (EIP-712, domain "DepositWallet" v1, verifyingContract = wallet).
struct Call {
    address target;
    uint256 value;
    bytes data;
}

struct Batch {
    address wallet;
    uint256 nonce;
    uint256 deadline;
    Call[] calls;
}

/// Polymarket CLOB v2 `Order` as the exchange hashes it.
struct Order {
    uint256 salt;
    address maker;
    address signer;
    uint256 tokenId;
    uint256 makerAmount;
    uint256 takerAmount;
    uint8 side;
    uint8 signatureType;
    uint256 timestamp;
    bytes32 metadata;
    bytes32 builder;
}

/// Function shapes the policy decodes (selectors only; never called).
interface IPolicyTargets {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function approve(address spender, uint256 amount) external;
    function wrap(address asset, address to, uint256 amount) external;
    function unwrap(address asset, address to, uint256 amount) external;
    function exactInputSingle(ExactInputSingleParams calldata p) external;
    function depositForBurn(uint256, uint32, bytes32, address, bytes32, uint256, uint32) external;
    function redeemPositions(address, bytes32, bytes32, uint256[] calldata) external;
    function setApprovalForAll(address, bool) external;
}

/// Per-user ERC-1271 owner of a Polymarket Deposit Wallet on Polygon (option A, #46; PRD > Vault risk findings 2b).
/// Moves the Executor scope of `apps/executor/src/wallet/policy.ts` on-chain:
/// - the user's EOA signs anything (65-byte ECDSA), so the user keeps full control;
/// - the Executor key signs only (a) wallet batches whose every call is allowlisted (approve to fixed spenders,
///   swap/wrap/unwrap into the wallet, CTF redeem, CCTP burn with mintRecipient = destinationCaller = Vault), or
///   (b) CLOB orders whose maker and signer are the wallet. No call can send funds anywhere else.
/// Executor signature: abi.encode(uint8 kind, bytes payload, bytes ecdsaSig), kind 1 = Batch, 2 = Order.
contract PolicyOwner {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    bytes4 internal constant INVALID = 0xffffffff;
    uint8 public constant KIND_BATCH = 1;
    uint8 public constant KIND_ORDER = 2;

    uint256 public constant MAX_DEADLINE = 1 hours;
    uint256 public constant MAX_CALLS = 16;
    uint256 public constant MAX_SLIPPAGE_BPS = 100;
    uint32 public constant MONAD_DOMAIN = 15;
    uint24 public constant USDC_SWAP_FEE = 100;

    // Polygon PoS (verified in spike #17; same as apps/executor/src/wallet/constants.ts).
    address public constant PUSD = 0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB;
    address public constant USDC = 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359;
    address public constant USDCE = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    address public constant ONRAMP = 0x93070a847efEf7F70739046A929D47a521F5B8ee;
    address public constant OFFRAMP = 0x2957922Eb93258b93368531d39fAcCA3B4dC5854;
    address public constant CTF = 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045;
    address public constant NEG_RISK_ADAPTER = 0xadA2005600Dec949baf300f4C6120000bDB6eAab;
    address public constant CTF_EXCHANGE = 0xE111180000d2663C0091e4f400237545B87B996B;
    address public constant NEG_RISK_EXCHANGE = 0xe2222d279d744050d28e00520010520000310F59;
    address public constant V2_EXCHANGE = 0xe3333700cA9d93003F00f0F71f8515005F6c00Aa;
    address public constant SWAP_ROUTER = 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45;
    address public constant TOKEN_MESSENGER = 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant CALL_TYPEHASH = keccak256("Call(address target,uint256 value,bytes data)");
    bytes32 internal constant BATCH_TYPEHASH = keccak256(
        "Batch(address wallet,uint256 nonce,uint256 deadline,Call[] calls)Call(address target,uint256 value,bytes data)"
    );
    bytes internal constant ORDER_TYPE =
        "Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)";
    bytes32 internal constant ORDER_TYPEHASH = keccak256(ORDER_TYPE);
    bytes32 internal constant TYPED_DATA_SIGN_TYPEHASH = keccak256(
        abi.encodePacked(
            "TypedDataSign(Order contents,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)",
            ORDER_TYPE
        )
    );

    address public immutable user;
    address public immutable wallet;
    /// Paras Vault on Monad: the only CCTP burn destination.
    address public immutable vault;
    /// Executor signing key; the user can rotate or revoke it (address(0)).
    address public executor;

    error PolicyViolation(string code);
    error OnlyUser();
    error CallFailed(bytes result);

    event ExecutorSet(address executor);

    constructor(address user_, address wallet_, address vault_, address executor_) {
        user = user_;
        wallet = wallet_;
        vault = vault_;
        executor = executor_;
        emit ExecutorSet(executor_);
    }

    modifier onlyUser() {
        if (msg.sender != user) revert OnlyUser();
        _;
    }

    function setExecutor(address executor_) external onlyUser {
        executor = executor_;
        emit ExecutorSet(executor_);
    }

    /// The wallet's owner-only functions (pause, timelocked withdraw, revoke) check msg.sender, so the user calls them here.
    function callWallet(bytes calldata data) external onlyUser returns (bytes memory) {
        (bool ok, bytes memory res) = wallet.call(data);
        if (!ok) revert CallFailed(res);
        return res;
    }

    /// ERC-1271. Reverts with `PolicyViolation` when the Executor signed something outside the allowlist.
    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        if (sig.length == 65) return _signedBy(user, hash, sig) ? MAGIC : INVALID;
        (uint8 kind, bytes memory payload, bytes memory esig) = abi.decode(sig, (uint8, bytes, bytes));
        if (executor == address(0) || !_signedBy(executor, hash, esig)) return INVALID;
        if (kind == KIND_BATCH) {
            Batch memory b = abi.decode(payload, (Batch));
            if (batchDigest(b) != hash) return INVALID;
            _checkBatch(b);
        } else if (kind == KIND_ORDER) {
            (Order memory o, string memory version, address exchange) = abi.decode(payload, (Order, string, address));
            if (orderDigest(o, version, exchange) != hash) return INVALID;
            _checkOrder(o, exchange);
        } else {
            return INVALID;
        }
        return MAGIC;
    }

    /// The digest the DepositWallet passes to its owner for `execute(batch, sig)`.
    function batchDigest(Batch memory b) public view returns (bytes32) {
        bytes32[] memory ch = new bytes32[](b.calls.length);
        for (uint256 i; i < ch.length; i++) {
            ch[i] = keccak256(abi.encode(CALL_TYPEHASH, b.calls[i].target, b.calls[i].value, keccak256(b.calls[i].data)));
        }
        bytes32 structHash =
            keccak256(abi.encode(BATCH_TYPEHASH, b.wallet, b.nonce, b.deadline, keccak256(abi.encodePacked(ch))));
        return _typed(_domain("DepositWallet", "1", wallet), structHash);
    }

    /// The digest the DepositWallet passes to its owner for a POLY_1271 order (ERC-7739 TypedDataSign nested in the
    /// exchange domain; same as `signPoly1271Order` in apps/executor/src/clob/order.ts).
    function orderDigest(Order memory o, string memory version, address exchange) public view returns (bytes32) {
        bytes32 contents = keccak256(
            bytes.concat(
                abi.encode(ORDER_TYPEHASH, o.salt, o.maker, o.signer, o.tokenId, o.makerAmount, o.takerAmount),
                abi.encode(o.side, o.signatureType, o.timestamp, o.metadata, o.builder)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                TYPED_DATA_SIGN_TYPEHASH,
                contents,
                keccak256("DepositWallet"),
                keccak256("1"),
                block.chainid,
                wallet,
                bytes32(0)
            )
        );
        return _typed(_domain("Polymarket CTF Exchange", version, exchange), structHash);
    }

    function _domain(string memory name, string memory version, address verifying) internal view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes(version)), block.chainid, verifying)
        );
    }

    function _typed(bytes32 domain, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _signedBy(address signer, bytes32 hash, bytes memory sig) internal pure returns (bool) {
        (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, sig);
        return err == ECDSA.RecoverError.NoError && rec == signer;
    }

    function _deny(string memory code) internal pure {
        revert PolicyViolation(code);
    }

    function _checkOrder(Order memory o, address exchange) internal view {
        if (!_isExchange(exchange)) _deny("exchange");
        if (o.maker != wallet) _deny("clob_maker");
        if (o.signer != wallet) _deny("clob_signer");
        if (o.signatureType != 3) _deny("clob_sig_type");
    }

    function _checkBatch(Batch memory b) internal view {
        if (b.wallet != wallet) _deny("wrong_wallet");
        if (b.deadline > block.timestamp + MAX_DEADLINE) _deny("deadline_far");
        if (b.calls.length == 0) _deny("empty_batch");
        if (b.calls.length > MAX_CALLS) _deny("too_many_calls");
        for (uint256 i; i < b.calls.length; i++) {
            _checkCall(b.calls[i]);
        }
    }

    function _checkCall(Call memory c) internal view {
        if (c.value != 0) _deny("native_value");
        address t = c.target;
        (bytes4 sel, bytes memory args) = _split(c.data);

        if (t == USDC || t == USDCE || t == PUSD) {
            if (sel != IPolicyTargets.approve.selector) _deny("token_move");
            (address spender,) = abi.decode(args, (address, uint256));
            bool ok = t == USDC
                ? spender == SWAP_ROUTER || spender == TOKEN_MESSENGER
                : t == USDCE ? spender == SWAP_ROUTER || spender == ONRAMP : spender == OFFRAMP || _isExchange(spender);
            if (!ok) _deny("spender");
            return;
        }

        if (t == ONRAMP || t == OFFRAMP) {
            if (sel != (t == ONRAMP ? IPolicyTargets.wrap.selector : IPolicyTargets.unwrap.selector)) _deny("ramp_fn");
            (address asset, address to,) = abi.decode(args, (address, address, uint256));
            if (asset != USDCE) _deny("ramp_asset");
            if (to != wallet) _deny("recipient");
            return;
        }

        if (t == SWAP_ROUTER) {
            if (sel != IPolicyTargets.exactInputSingle.selector) _deny("swap_fn");
            IPolicyTargets.ExactInputSingleParams memory p = abi.decode(args, (IPolicyTargets.ExactInputSingleParams));
            bool pair = (p.tokenIn == USDC && p.tokenOut == USDCE) || (p.tokenIn == USDCE && p.tokenOut == USDC);
            if (!pair) _deny("swap_pair");
            if (p.fee != USDC_SWAP_FEE) _deny("swap_fee");
            if (p.recipient != wallet) _deny("recipient");
            if (p.amountOutMinimum * 10_000 < p.amountIn * (10_000 - MAX_SLIPPAGE_BPS)) _deny("slippage");
            return;
        }

        if (t == TOKEN_MESSENGER) {
            if (sel != IPolicyTargets.depositForBurn.selector) _deny("burn_fn");
            (uint256 amount, uint32 domain, bytes32 mintRecipient, address burnToken, bytes32 destCaller, uint256 maxFee,) =
                abi.decode(args, (uint256, uint32, bytes32, address, bytes32, uint256, uint32));
            bytes32 vault32 = bytes32(uint256(uint160(vault)));
            if (domain != MONAD_DOMAIN) _deny("burn_domain");
            if (mintRecipient != vault32) _deny("burn_recipient");
            if (destCaller != vault32) _deny("burn_caller");
            if (burnToken != USDC) _deny("burn_token");
            if (maxFee * 100 > amount) _deny("burn_fee");
            return;
        }

        if (t == CTF) {
            if (sel == IPolicyTargets.redeemPositions.selector) {
                if (abi.decode(args, (address)) != PUSD) _deny("redeem_collateral");
                return;
            }
            if (sel != IPolicyTargets.setApprovalForAll.selector) _deny("ctf_fn");
            (address operator, bool approved) = abi.decode(args, (address, bool));
            if (approved && !_isExchange(operator) && operator != NEG_RISK_ADAPTER) _deny("operator");
            return;
        }

        if (t == NEG_RISK_ADAPTER) {
            // Only redeem; the adapter pays pUSD to msg.sender (the wallet).
            if (sel != IPolicyTargets.redeemPositions.selector) _deny("negrisk_fn");
            if (abi.decode(args, (address)) != PUSD) _deny("redeem_collateral");
            return;
        }

        _deny("target");
    }

    function _isExchange(address a) internal pure returns (bool) {
        return a == CTF_EXCHANGE || a == NEG_RISK_EXCHANGE || a == V2_EXCHANGE;
    }

    function _split(bytes memory data) internal pure returns (bytes4 sel, bytes memory args) {
        if (data.length < 4) _deny("unknown_selector");
        sel = bytes4(data);
        args = new bytes(data.length - 4);
        for (uint256 i; i < args.length; i++) {
            args[i] = data[i + 4];
        }
    }
}
