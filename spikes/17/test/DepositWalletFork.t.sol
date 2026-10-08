// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console, Vm} from "forge-std/Test.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

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

interface IFactory {
    function owner() external view returns (address);
    function addAdmin(address) external;
    function addOperator(address) external;
    function deploy(address[] calldata owners, bytes32[] calldata ids) external;
    function proxy(Batch[] calldata batches, bytes[] calldata sigs) external;
    function predictWalletAddress(bytes32 id) external view returns (address);
}

interface IWallet {
    function authorizeSessionSigner(address, uint256) external;
    function sessionSignerAuthorizedUntil(address) external view returns (uint256);
    function owner() external view returns (address);
    function transferOwnership(address, uint256) external;
}

/// Polygon fork against the REAL Polymarket DepositWalletFactory/DepositWallet implementation.
/// Question: what can a session signer do on-chain? (docs say "CLOB scope"; contract source says otherwise)
contract DepositWalletForkTest is Test {
    IFactory constant FACTORY = IFactory(0x00000000000Fb5C9ADea0298D729A0CB3823Cc07);
    address constant BEACON = 0x7A18EDfe055488A3128f01F563e5B479D92ffc3a;
    address constant PUSD = 0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB;

    bytes32 constant CALL_TYPEHASH = keccak256("Call(address target,uint256 value,bytes data)");
    bytes32 constant BATCH_TYPEHASH = keccak256(
        "Batch(address wallet,uint256 nonce,uint256 deadline,Call[] calls)Call(address target,uint256 value,bytes data)"
    );
    bytes32 constant MAGIC = 0x6492649264926492649264926492649264926492649264926492649264926492;

    Vm.Wallet owner;
    Vm.Wallet session;
    address wallet;

    function setUp() public {
        owner = vm.createWallet("owner");
        session = vm.createWallet("session");
        // test-only: make ourselves an operator (stands in for Polymarket's relayer, the only party who can submit batches)
        address fOwner = FACTORY.owner();
        vm.prank(fOwner);
        FACTORY.addAdmin(address(this));
        FACTORY.addOperator(address(this));
        address[] memory o = new address[](1);
        o[0] = owner.addr;
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = keccak256("paras-spike-17");
        wallet = FACTORY.predictWalletAddress(ids[0]);
        FACTORY.deploy(o, ids);
        assertEq(IWallet(wallet).owner(), owner.addr);
        deal(PUSD, wallet, 1_000e6);
    }

    function _digest(Batch memory b) internal view returns (bytes32) {
        bytes32[] memory ch = new bytes32[](b.calls.length);
        for (uint256 i; i < b.calls.length; i++) {
            ch[i] = keccak256(abi.encode(CALL_TYPEHASH, b.calls[i].target, b.calls[i].value, keccak256(b.calls[i].data)));
        }
        bytes32 structHash =
            keccak256(abi.encode(BATCH_TYPEHASH, b.wallet, b.nonce, b.deadline, keccak256(abi.encodePacked(ch))));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("DepositWallet"),
                keccak256("1"),
                block.chainid,
                wallet
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _sign(Vm.Wallet memory w, Batch memory b) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(w.privateKey, _digest(b));
        return abi.encodePacked(r, s, v);
    }

    function _wrapSession(address s, bytes memory inner) internal pure returns (bytes memory) {
        return bytes.concat(abi.encode(s, uint256(0), inner), MAGIC);
    }

    function _one(address target, bytes memory data, uint256 nonce) internal view returns (Batch memory b) {
        b.wallet = wallet;
        b.nonce = nonce;
        b.deadline = block.timestamp + 1 hours;
        b.calls = new Call[](1);
        b.calls[0] = Call(target, 0, data);
    }

    function _submit(Batch memory b, bytes memory sig) internal {
        Batch[] memory bs = new Batch[](1);
        bs[0] = b;
        bytes[] memory ss = new bytes[](1);
        ss[0] = sig;
        FACTORY.proxy(bs, ss);
    }

    function _authorizeSession() internal {
        Batch memory b = _one(wallet, abi.encodeCall(IWallet.authorizeSessionSigner, (session.addr, block.timestamp + 180 days)), 0);
        _submit(b, _sign(owner, b));
        assertGt(IWallet(wallet).sessionSignerAuthorizedUntil(session.addr), block.timestamp);
    }

    /// FINDING: session signer batch can transfer pUSD to ANY address. On-chain scope = "anything except self/beacon".
    function test_sessionSignerCanTransferToArbitraryAddress() public {
        _authorizeSession();
        address attacker = address(0xA77AC4);
        Batch memory b = _one(PUSD, abi.encodeCall(IERC20.transfer, (attacker, 1_000e6)), 1);
        _submit(b, _wrapSession(session.addr, _sign(session, b)));
        assertEq(IERC20(PUSD).balanceOf(attacker), 1_000e6, "session key drained wallet on-chain");
    }

    /// Session signer cannot self-call (cannot rotate owner / authorize more signers).
    function test_sessionSignerCannotSelfCall() public {
        _authorizeSession();
        Batch memory b = _one(wallet, abi.encodeCall(IWallet.transferOwnership, (session.addr, block.timestamp + 1 days)), 1);
        bytes memory sig = _wrapSession(session.addr, _sign(session, b));
        vm.expectRevert();
        _submit(b, sig);
    }

    /// Session signer cannot call the beacon.
    function test_sessionSignerCannotCallBeacon() public {
        _authorizeSession();
        Batch memory b = _one(BEACON, hex"", 1);
        bytes memory sig = _wrapSession(session.addr, _sign(session, b));
        vm.expectRevert();
        _submit(b, sig);
    }

    /// Only factory operators can submit batches: the Executor cannot execute on its own, even with a valid session signature.
    function test_nonOperatorCannotSubmit() public {
        _authorizeSession();
        Batch memory b = _one(PUSD, abi.encodeCall(IERC20.transfer, (address(0xBEEF), 1)), 1);
        bytes memory sig = _wrapSession(session.addr, _sign(session, b));
        vm.prank(address(0xE8EC));
        Batch[] memory bs = new Batch[](1);
        bs[0] = b;
        bytes[] memory ss = new bytes[](1);
        ss[0] = sig;
        vm.expectRevert();
        FACTORY.proxy(bs, ss);
    }

    /// Expired / unauthorized session signer is rejected.
    function test_unauthorizedSessionSignerRejected() public {
        Batch memory b = _one(PUSD, abi.encodeCall(IERC20.transfer, (address(0xBEEF), 1)), 0);
        bytes memory sig = _wrapSession(session.addr, _sign(session, b));
        vm.expectRevert();
        _submit(b, sig);
    }

    /// Expiry: after validUntil, session signer is rejected.
    function test_sessionSignerExpires() public {
        _authorizeSession();
        vm.warp(block.timestamp + 181 days);
        Batch memory b = _one(PUSD, abi.encodeCall(IERC20.transfer, (address(0xBEEF), 1)), 1);
        b.deadline = block.timestamp + 1 hours;
        bytes memory sig = _wrapSession(session.addr, _sign(session, b));
        vm.expectRevert();
        _submit(b, sig);
    }
}
