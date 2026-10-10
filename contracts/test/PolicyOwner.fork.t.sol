// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PolicyOwner, Batch, Call, Order, IPolicyTargets} from "../src/PolicyOwner.sol";
import {PolicyOwnerHelpers} from "./PolicyOwner.t.sol";

interface IFactory {
    function owner() external view returns (address);
    function addAdmin(address) external;
    function addOperator(address) external;
    function deploy(address[] calldata owners, bytes32[] calldata ids) external;
    function proxy(Batch[] calldata batches, bytes[] calldata sigs) external;
    function predictWalletAddress(bytes32 id) external view returns (address);
}

interface IWallet {
    function owner() external view returns (address);
    function nonce() external view returns (uint256);
    function pendingOwnerNonce() external view returns (uint256);
    function authorizeSessionSigner(address, uint256) external;
    function revokeSessionSigner(address) external;
    function transferOwnership(address, uint256) external;
    function completeOwnershipHandover(bytes calldata) external;
    function pause() external;
    function withdrawERC20(address, address, uint256) external;
    function isValidSignature(bytes32, bytes calldata) external view returns (bytes4);
}

/// PolicyOwner as the owner of the REAL Polymarket DepositWallet on a Polygon fork. Skipped unless POLYGON_RPC_URL is
/// set (CI is offline):
///   POLYGON_RPC_URL=https://polygon-bor-rpc.publicnode.com forge test --match-contract PolicyOwnerForkTest
/// This contract stands in for Polymarket's relayer (a factory operator), the only party that can submit batches.
contract PolicyOwnerForkTest is PolicyOwnerHelpers {
    IFactory constant FACTORY = IFactory(0x00000000000Fb5C9ADea0298D729A0CB3823Cc07);
    bytes32 constant SESSION_MAGIC = 0x6492649264926492649264926492649264926492649264926492649264926492;
    address wallet;

    function setUp() public {
        string memory rpc = vm.envOr("POLYGON_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        vm.prank(FACTORY.owner());
        FACTORY.addAdmin(address(this));
        FACTORY.addOperator(address(this));
    }

    function _deploy(address owner_, bytes32 id) internal returns (address w) {
        w = FACTORY.predictWalletAddress(id);
        address[] memory o = new address[](1);
        o[0] = owner_;
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = id;
        FACTORY.deploy(o, ids);
    }

    /// New wallet owned by a fresh PolicyOwner (address predicted before deploy).
    function _deployWithPolicyOwner() internal {
        bytes32 id = keccak256("paras-46");
        wallet = FACTORY.predictWalletAddress(id);
        po = new PolicyOwner(user, wallet, vault, executor);
        _deploy(address(po), id);
        assertEq(IWallet(wallet).owner(), address(po));
    }

    function _submit(Batch memory b, bytes memory sig) internal {
        Batch[] memory bs = new Batch[](1);
        bs[0] = b;
        bytes[] memory ss = new bytes[](1);
        ss[0] = sig;
        FACTORY.proxy(bs, ss);
    }

    function _withNonce(Batch memory b) internal view returns (Batch memory) {
        b.nonce = IWallet(wallet).nonce();
        return b;
    }

    function _execSubmit(Batch memory b) internal {
        b = _withNonce(b);
        (, bytes memory sig) = _execBatch(b);
        _submit(b, sig);
    }

    function _userSubmit(Batch memory b) internal {
        b = _withNonce(b);
        _submit(b, _sig(userKey, po.batchDigest(b)));
    }

    function test_executorConvertBatchExecutes() public {
        _deployWithPolicyOwner();
        deal(po.USDC(), wallet, 100e6);
        _execSubmit(_batch(_convertCalls(wallet, 100e6)));
        assertGe(IERC20(po.PUSD()).balanceOf(wallet), 99e6, "wrapped to pUSD in the wallet");
        assertEq(IERC20(po.USDC()).balanceOf(wallet), 0);
        assertEq(IERC20(po.PUSD()).allowance(wallet, po.CTF_EXCHANGE()), type(uint256).max);
    }

    /// The finding of spike #17 (session key drains the wallet) no longer holds with a PolicyOwner owner.
    function test_executorTransferToAttackerRevertsOnChain() public {
        _deployWithPolicyOwner();
        deal(po.PUSD(), wallet, 1_000e6);
        Batch memory b = _withNonce(_one(po.PUSD(), abi.encodeCall(IERC20.transfer, (executor, 1_000e6))));
        (, bytes memory sig) = _execBatch(b);
        vm.expectRevert();
        _submit(b, sig);
        assertEq(IERC20(po.PUSD()).balanceOf(wallet), 1_000e6);
    }

    function test_executorCannotRotateOwnerOrAddSessionSigner() public {
        _deployWithPolicyOwner();
        Batch memory b = _withNonce(
            _one(wallet, abi.encodeCall(IWallet.authorizeSessionSigner, (executor, block.timestamp + 180 days)))
        );
        (, bytes memory sig) = _execBatch(b);
        vm.expectRevert();
        _submit(b, sig);
        b = _withNonce(_one(wallet, abi.encodeCall(IWallet.transferOwnership, (executor, block.timestamp + 1 hours))));
        (, sig) = _execBatch(b);
        vm.expectRevert();
        _submit(b, sig);
    }

    function test_userKeepsFullControl() public {
        _deployWithPolicyOwner();
        deal(po.PUSD(), wallet, 10e6);
        _userSubmit(_one(po.PUSD(), abi.encodeCall(IERC20.transfer, (user, 10e6))));
        assertEq(IERC20(po.PUSD()).balanceOf(user), 10e6);
    }

    /// Emergency exit: the user pauses through the PolicyOwner and withdraws after the wallet's timelock.
    function test_userEscapeHatch() public {
        _deployWithPolicyOwner();
        deal(po.PUSD(), wallet, 10e6);
        vm.startPrank(user);
        po.callWallet(abi.encodeCall(IWallet.pause, ()));
        vm.warp(block.timestamp + 1 hours + 1);
        po.callWallet(abi.encodeCall(IWallet.withdrawERC20, (po.PUSD(), user, 10e6)));
        vm.stopPrank();
        assertEq(IERC20(po.PUSD()).balanceOf(user), 10e6);
    }

    /// POLY_1271 order through the wallet's ERC-7739 path, exactly as the exchange verifies it.
    function test_executorOrderValidThroughWallet() public {
        _deployWithPolicyOwner();
        (bytes32 orderHash, bytes memory sig) = _orderForExchange(_order(wallet));
        vm.prank(po.CTF_EXCHANGE());
        assertEq(IWallet(wallet).isValidSignature(orderHash, sig), MAGIC);

        Order memory bad = _order(wallet);
        bad.maker = executor;
        (orderHash, sig) = _orderForExchange(bad);
        vm.prank(po.CTF_EXCHANGE());
        assertEq(IWallet(wallet).isValidSignature(orderHash, sig), INVALID);
    }

    /// Exchange-side hash + wallet signature (envelope ++ appDomainSeparator ++ contentsHash ++ type ++ uint16 len).
    function _orderForExchange(Order memory o) internal view returns (bytes32 orderHash, bytes memory sig) {
        bytes memory orderType =
            "Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)";
        bytes32 contents = keccak256(
            bytes.concat(
                abi.encode(keccak256(orderType), o.salt, o.maker, o.signer, o.tokenId, o.makerAmount, o.takerAmount),
                abi.encode(o.side, o.signatureType, o.timestamp, o.metadata, o.builder)
            )
        );
        bytes32 app = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Polymarket CTF Exchange"),
                keccak256("2"),
                block.chainid,
                po.CTF_EXCHANGE()
            )
        );
        orderHash = keccak256(abi.encodePacked("\x19\x01", app, contents));
        (, bytes memory env) = _execOrder(o, po.CTF_EXCHANGE());
        sig = abi.encodePacked(env, app, contents, orderType, uint16(orderType.length));
    }

    /// Migration of an existing EOA-owned wallet: one user-signed batch revokes the old (unscoped) session key and
    /// starts the handover; the user's signature completes it. Afterwards only the PolicyOwner scope applies.
    function test_migrateExistingWallet() public {
        uint256 sessionKey = 0x5E55;
        address session = vm.addr(sessionKey);
        bytes32 id = keccak256("paras-46-legacy");
        wallet = _deploy(user, id);
        po = new PolicyOwner(user, wallet, vault, executor);

        // Option-B state: an owner-signed batch authorized the Executor's session key. (`batchDigest` only reads
        // `po.wallet`, so it is the wallet's digest regardless of the current owner.)
        Batch memory b = _withNonce(
            _one(wallet, abi.encodeCall(IWallet.authorizeSessionSigner, (session, block.timestamp + 180 days)))
        );
        _submit(b, _sig(userKey, po.batchDigest(b)));

        Call[] memory c = new Call[](2);
        c[0] = Call(wallet, 0, abi.encodeCall(IWallet.revokeSessionSigner, (session)));
        c[1] = Call(wallet, 0, abi.encodeCall(IWallet.transferOwnership, (address(po), block.timestamp + 1 hours)));
        b = _withNonce(_batch(c));
        _submit(b, _sig(userKey, po.batchDigest(b)));

        bytes32 handover = keccak256(
            abi.encodePacked(
                "\x19\x01",
                keccak256(
                    abi.encode(
                        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                        keccak256("DepositWallet"),
                        keccak256("1"),
                        block.chainid,
                        wallet
                    )
                ),
                keccak256(
                    abi.encode(
                        keccak256("OwnershipHandover(address newOwner,uint256 nonce)"),
                        address(po),
                        IWallet(wallet).pendingOwnerNonce()
                    )
                )
            )
        );
        IWallet(wallet).completeOwnershipHandover(_sig(userKey, handover));
        assertEq(IWallet(wallet).owner(), address(po));

        // Old session key is gone.
        deal(po.PUSD(), wallet, 10e6);
        b = _withNonce(_one(po.PUSD(), abi.encodeCall(IERC20.transfer, (session, 10e6))));
        bytes memory sessionSig =
            bytes.concat(abi.encode(session, uint256(0), _sig(sessionKey, po.batchDigest(b))), SESSION_MAGIC);
        vm.expectRevert();
        _submit(b, sessionSig);

        // Executor works within the allowlist, and the user still signs anything.
        _execSubmit(_one(po.PUSD(), abi.encodeCall(IPolicyTargets.approve, (po.CTF_EXCHANGE(), 1))));
        _userSubmit(_one(po.PUSD(), abi.encodeCall(IERC20.transfer, (user, 10e6))));
        assertEq(IERC20(po.PUSD()).balanceOf(user), 10e6);
    }
}
