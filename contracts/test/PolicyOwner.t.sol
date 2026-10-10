// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PolicyOwner, Batch, Call, Order, IPolicyTargets} from "../src/PolicyOwner.sol";

/// Builders for Executor/user signatures and the allowlisted calls (mirrors apps/executor/src/wallet/calls.ts).
abstract contract PolicyOwnerHelpers is Test {
    bytes4 constant MAGIC = 0x1626ba7e;
    bytes4 constant INVALID = 0xffffffff;

    uint256 userKey = 0xA11CE;
    uint256 executorKey = 0xE8EC;
    address user = vm.addr(userKey);
    address executor = vm.addr(executorKey);
    address vault = makeAddr("vault");
    PolicyOwner po;

    function _sig(uint256 k, bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(k, d);
        return abi.encodePacked(r, s, v);
    }

    function _batch(Call[] memory calls) internal view returns (Batch memory b) {
        b.wallet = po.wallet();
        b.deadline = block.timestamp + 10 minutes;
        b.calls = calls;
    }

    function _one(address target, bytes memory data) internal view returns (Batch memory) {
        Call[] memory calls = new Call[](1);
        calls[0] = Call(target, 0, data);
        return _batch(calls);
    }

    /// Executor envelope for a batch; returns (digest, signature) as the wallet hands them to its owner.
    function _execBatch(Batch memory b) internal view returns (bytes32 d, bytes memory sig) {
        d = po.batchDigest(b);
        sig = abi.encode(po.KIND_BATCH(), abi.encode(b), _sig(executorKey, d));
    }

    function _order(address maker) internal pure returns (Order memory o) {
        o = Order(1, maker, maker, 42, 5e6, 10e6, 0, 3, 1_700_000_000_000, bytes32(0), bytes32(uint256(7)));
    }

    function _execOrder(Order memory o, address exchange) internal view returns (bytes32 d, bytes memory sig) {
        d = po.orderDigest(o, "2", exchange);
        sig = abi.encode(po.KIND_ORDER(), abi.encode(o, "2", exchange), _sig(executorKey, d));
    }

    // allowlisted calls
    function _approve(address token, address spender) internal pure returns (Call memory) {
        return Call(token, 0, abi.encodeCall(IPolicyTargets.approve, (spender, type(uint256).max)));
    }

    function _swap(address tokenIn, address tokenOut, address to, uint256 amt, uint256 minOut)
        internal
        pure
        returns (Call memory)
    {
        return Call(
            0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45,
            0,
            abi.encodeCall(
                IPolicyTargets.exactInputSingle,
                (IPolicyTargets.ExactInputSingleParams(tokenIn, tokenOut, 100, to, amt, minOut, 0))
            )
        );
    }

    function _burn(uint256 amt, bytes32 recipient, bytes32 caller) internal pure returns (Call memory) {
        return Call(
            0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d,
            0,
            abi.encodeCall(
                IPolicyTargets.depositForBurn,
                (amt, 15, recipient, 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359, caller, 0, 2000)
            )
        );
    }

    function _vault32() internal view returns (bytes32) {
        return bytes32(uint256(uint160(vault)));
    }

    /// Funding: native USDC -> USDC.e -> pUSD, approve an exchange (calls.ts buildConvertCalls).
    function _convertCalls(address w, uint256 amt) internal view returns (Call[] memory c) {
        c = new Call[](5);
        c[0] = _approve(po.USDC(), po.SWAP_ROUTER());
        c[1] = _swap(po.USDC(), po.USDCE(), w, amt, amt * 99 / 100);
        c[2] = _approve(po.USDCE(), po.ONRAMP());
        c[3] = Call(po.ONRAMP(), 0, abi.encodeCall(IPolicyTargets.wrap, (po.USDCE(), w, amt * 99 / 100)));
        c[4] = _approve(po.PUSD(), po.CTF_EXCHANGE());
    }

    /// Sweep-back: pUSD -> USDC.e -> native USDC -> CCTP burn to the Vault (calls.ts buildSweepCalls).
    function _sweepCalls(address w, uint256 amt) internal view returns (Call[] memory c) {
        c = new Call[](6);
        c[0] = _approve(po.PUSD(), po.OFFRAMP());
        c[1] = Call(po.OFFRAMP(), 0, abi.encodeCall(IPolicyTargets.unwrap, (po.USDCE(), w, amt)));
        c[2] = _approve(po.USDCE(), po.SWAP_ROUTER());
        c[3] = _swap(po.USDCE(), po.USDC(), w, amt, amt * 99 / 100);
        c[4] = _approve(po.USDC(), po.TOKEN_MESSENGER());
        c[5] = _burn(amt * 99 / 100, _vault32(), _vault32());
    }
}

contract PolicyOwnerTest is PolicyOwnerHelpers {
    address wallet = makeAddr("depositWallet");

    function setUp() public {
        po = new PolicyOwner(user, wallet, vault, executor);
    }

    function _accepts(Batch memory b) internal view returns (bool) {
        (bytes32 d, bytes memory sig) = _execBatch(b);
        return po.isValidSignature(d, sig) == MAGIC;
    }

    function _deniedWith(Batch memory b, string memory code) internal {
        (bytes32 d, bytes memory sig) = _execBatch(b);
        vm.expectRevert(abi.encodeWithSelector(PolicyOwner.PolicyViolation.selector, code));
        po.isValidSignature(d, sig);
    }

    // --- user EOA: full control

    function test_userSignsAnything(bytes32 h) public view {
        assertEq(po.isValidSignature(h, _sig(userKey, h)), MAGIC);
    }

    function test_otherEoaRejected(bytes32 h, uint256 k) public view {
        k = bound(k, 1, 1e30);
        vm.assume(k != userKey);
        assertEq(po.isValidSignature(h, _sig(k, h)), INVALID);
    }

    function test_executorRawEcdsaRejected() public view {
        // A bare 65-byte Executor signature is checked against the user, so it can never authorize anything.
        bytes32 h = keccak256("anything");
        assertEq(po.isValidSignature(h, _sig(executorKey, h)), INVALID);
    }

    // --- Executor: allowlisted batches

    function test_executorConvertAndSweepAccepted() public view {
        assertTrue(_accepts(_batch(_convertCalls(wallet, 100e6))));
        assertTrue(_accepts(_batch(_sweepCalls(wallet, 100e6))));
    }

    function test_executorRedeemAndCtfApprovalAccepted() public view {
        Call[] memory c = new Call[](4);
        uint256[] memory sets = new uint256[](2);
        (sets[0], sets[1]) = (1, 2);
        c[0] = Call(po.CTF(), 0, abi.encodeCall(IPolicyTargets.setApprovalForAll, (po.NEG_RISK_ADAPTER(), true)));
        c[1] = Call(po.CTF(), 0, abi.encodeCall(IPolicyTargets.setApprovalForAll, (address(0xA11), false)));
        c[2] = Call(po.CTF(), 0, abi.encodeCall(IPolicyTargets.redeemPositions, (po.PUSD(), 0, keccak256("c"), sets)));
        c[3] = Call(
            po.NEG_RISK_ADAPTER(),
            0,
            abi.encodeCall(IPolicyTargets.redeemPositions, (po.PUSD(), 0, keccak256("c"), sets))
        );
        assertTrue(_accepts(_batch(c)));
    }

    function test_digestMustMatchBatch() public view {
        (, bytes memory sig) = _execBatch(_batch(_convertCalls(wallet, 1e6)));
        // A valid-looking envelope used for some other digest (e.g. a different, malicious batch) is invalid.
        bytes32 other = po.batchDigest(_one(po.PUSD(), abi.encodeWithSignature("transfer(address,uint256)", user, 1)));
        assertEq(po.isValidSignature(other, sig), INVALID);
    }

    function test_envelopeSignedByNonExecutorRejected() public view {
        Batch memory b = _batch(_convertCalls(wallet, 1e6));
        bytes32 d = po.batchDigest(b);
        bytes memory sig = abi.encode(po.KIND_BATCH(), abi.encode(b), _sig(0xBAD, d));
        assertEq(po.isValidSignature(d, sig), INVALID);
    }

    function test_revokedExecutorRejected() public {
        (bytes32 d, bytes memory sig) = _execBatch(_batch(_convertCalls(wallet, 1e6)));
        vm.prank(user);
        po.setExecutor(address(0));
        assertEq(po.isValidSignature(d, sig), INVALID);
    }

    function test_onlyUserManages() public {
        vm.expectRevert(PolicyOwner.OnlyUser.selector);
        vm.prank(executor);
        po.setExecutor(executor);
        vm.expectRevert(PolicyOwner.OnlyUser.selector);
        vm.prank(executor);
        po.callWallet("");
    }

    // --- Executor: denials

    function test_tokenTransferDenied() public {
        _deniedWith(_one(po.PUSD(), abi.encodeWithSignature("transfer(address,uint256)", executor, 1)), "token_move");
        _deniedWith(
            _one(po.USDC(), abi.encodeWithSignature("transferFrom(address,address,uint256)", wallet, executor, 1)),
            "token_move"
        );
    }

    function test_selfCallDenied() public {
        _deniedWith(_one(wallet, abi.encodeWithSignature("transferOwnership(address,uint256)", executor, 1)), "target");
        _deniedWith(_one(address(po), abi.encodeCall(PolicyOwner.setExecutor, (executor))), "target");
    }

    function test_batchShapeDenied() public {
        Batch memory b = _batch(_convertCalls(wallet, 1e6));
        b.deadline = block.timestamp + 1 hours + 1;
        _deniedWith(b, "deadline_far");

        b = _batch(_convertCalls(wallet, 1e6));
        b.calls[0].value = 1;
        _deniedWith(b, "native_value");

        _deniedWith(_batch(new Call[](0)), "empty_batch");
        _deniedWith(_batch(new Call[](17)), "too_many_calls");
        _deniedWith(_one(po.PUSD(), hex"0911"), "unknown_selector");
    }

    function test_wrongWalletDenied() public {
        Batch memory b = _batch(_convertCalls(wallet, 1e6));
        b.wallet = makeAddr("otherWallet");
        _deniedWith(b, "wrong_wallet");
    }

    function test_swapSlippageAndBurnFeeDenied() public {
        _deniedWith(_batch(_c(_swap(po.USDC(), po.USDCE(), wallet, 100e6, 98e6))), "slippage");
        Call memory burn = _burn(100e6, _vault32(), _vault32());
        burn.data = abi.encodeCall(
            IPolicyTargets.depositForBurn, (100e6, 15, _vault32(), po.USDC(), _vault32(), 1e6 + 1, 2000)
        );
        _deniedWith(_batch(_c(burn)), "burn_fee");
    }

    function test_burnToOtherDomainDenied() public {
        Call memory burn = _burn(1e6, _vault32(), _vault32());
        burn.data = abi.encodeCall(IPolicyTargets.depositForBurn, (1e6, 0, _vault32(), po.USDC(), _vault32(), 0, 2000));
        _deniedWith(_batch(_c(burn)), "burn_domain");
    }

    function _c(Call memory x) internal pure returns (Call[] memory c) {
        c = new Call[](1);
        c[0] = x;
    }

    // --- fuzz: an Executor-signed batch can never route funds anywhere but the wallet / Vault

    function _allowlisted(address t) internal view returns (bool) {
        return t == po.PUSD() || t == po.USDC() || t == po.USDCE() || t == po.ONRAMP() || t == po.OFFRAMP()
            || t == po.CTF() || t == po.NEG_RISK_ADAPTER() || t == po.SWAP_ROUTER() || t == po.TOKEN_MESSENGER();
    }

    function testFuzz_anyOtherTargetDenied(address target, bytes calldata data) public {
        vm.assume(!_allowlisted(target));
        vm.assume(data.length >= 4);
        _deniedWith(_one(target, data), "target");
    }

    function testFuzz_approveToOtherSpenderDenied(uint8 tokenIdx, address spender) public {
        address token = [po.USDC(), po.USDCE(), po.PUSD()][tokenIdx % 3];
        vm.assume(
            spender != po.SWAP_ROUTER() && spender != po.TOKEN_MESSENGER() && spender != po.ONRAMP()
                && spender != po.OFFRAMP() && spender != po.CTF_EXCHANGE() && spender != po.NEG_RISK_EXCHANGE()
                && spender != po.V2_EXCHANGE()
        );
        _deniedWith(_batch(_c(_approve(token, spender))), "spender");
    }

    function testFuzz_rampRecipientMustBeWallet(address to, bool unwrap) public {
        vm.assume(to != wallet);
        address ramp = unwrap ? po.OFFRAMP() : po.ONRAMP();
        bytes memory data = unwrap
            ? abi.encodeCall(IPolicyTargets.unwrap, (po.USDCE(), to, 1e6))
            : abi.encodeCall(IPolicyTargets.wrap, (po.USDCE(), to, 1e6));
        _deniedWith(_one(ramp, data), "recipient");
    }

    function testFuzz_swapRecipientMustBeWallet(address to, uint128 amt) public {
        vm.assume(to != wallet);
        _deniedWith(_batch(_c(_swap(po.USDC(), po.USDCE(), to, amt, amt))), "recipient");
    }

    function testFuzz_burnMustTargetVault(bytes32 recipient, bytes32 caller) public {
        if (recipient != _vault32()) _deniedWith(_batch(_c(_burn(1e6, recipient, _vault32()))), "burn_recipient");
        if (caller != _vault32()) _deniedWith(_batch(_c(_burn(1e6, _vault32(), caller))), "burn_caller");
    }

    function testFuzz_ctfOperatorAllowlisted(address operator) public {
        vm.assume(
            operator != po.CTF_EXCHANGE() && operator != po.NEG_RISK_EXCHANGE() && operator != po.V2_EXCHANGE()
                && operator != po.NEG_RISK_ADAPTER()
        );
        _deniedWith(_one(po.CTF(), abi.encodeCall(IPolicyTargets.setApprovalForAll, (operator, true))), "operator");
    }

    /// Any selector on an allowlisted target other than the allowed ones is denied (no transfer/transferFrom/etc.).
    function testFuzz_unknownSelectorOnTokenDenied(uint8 tokenIdx, bytes4 sel, bytes calldata rest) public {
        vm.assume(sel != IPolicyTargets.approve.selector);
        address token = [po.USDC(), po.USDCE(), po.PUSD()][tokenIdx % 3];
        _deniedWith(_one(token, bytes.concat(sel, rest)), "token_move");
    }

    /// One bad call poisons the whole batch, wherever it sits.
    function testFuzz_badCallAnywhereDeniesBatch(uint8 pos, address attacker) public {
        vm.assume(attacker != wallet);
        Call[] memory good = _convertCalls(wallet, 1e6);
        Call[] memory c = new Call[](good.length + 1);
        uint256 p = pos % c.length;
        for (uint256 i; i < c.length; i++) {
            c[i] = i == p
                ? Call(po.PUSD(), 0, abi.encodeWithSignature("transfer(address,uint256)", attacker, 1e6))
                : good[i < p ? i : i - 1];
        }
        _deniedWith(_batch(c), "token_move");
    }

    // --- orders

    function test_executorOrderAccepted() public view {
        (bytes32 d, bytes memory sig) = _execOrder(_order(wallet), po.CTF_EXCHANGE());
        assertEq(po.isValidSignature(d, sig), MAGIC);
        (d, sig) = _execOrder(_order(wallet), po.NEG_RISK_EXCHANGE());
        assertEq(po.isValidSignature(d, sig), MAGIC);
    }

    function testFuzz_orderMakerAndSignerMustBeWallet(address other) public {
        vm.assume(other != wallet);
        Order memory o = _order(wallet);
        o.maker = other;
        (bytes32 d, bytes memory sig) = _execOrder(o, po.CTF_EXCHANGE());
        vm.expectRevert(abi.encodeWithSelector(PolicyOwner.PolicyViolation.selector, "clob_maker"));
        po.isValidSignature(d, sig);

        o = _order(wallet);
        o.signer = other;
        (d, sig) = _execOrder(o, po.CTF_EXCHANGE());
        vm.expectRevert(abi.encodeWithSelector(PolicyOwner.PolicyViolation.selector, "clob_signer"));
        po.isValidSignature(d, sig);
    }

    function testFuzz_orderExchangeAllowlisted(address exchange) public {
        vm.assume(exchange != po.CTF_EXCHANGE() && exchange != po.NEG_RISK_EXCHANGE() && exchange != po.V2_EXCHANGE());
        (bytes32 d, bytes memory sig) = _execOrder(_order(wallet), exchange);
        vm.expectRevert(abi.encodeWithSelector(PolicyOwner.PolicyViolation.selector, "exchange"));
        po.isValidSignature(d, sig);
    }

    /// An order envelope can never authorize a batch digest (and vice versa).
    function test_orderEnvelopeCannotAuthorizeBatch() public view {
        bytes32 batchD =
            po.batchDigest(_one(po.PUSD(), abi.encodeWithSignature("transfer(address,uint256)", executor, 1)));
        Order memory o = _order(wallet);
        bytes memory sig = abi.encode(po.KIND_ORDER(), abi.encode(o, "2", po.CTF_EXCHANGE()), _sig(executorKey, batchD));
        assertEq(po.isValidSignature(batchD, sig), INVALID);
    }

    function test_unknownKindRejected() public view {
        (bytes32 d,) = _execBatch(_batch(_convertCalls(wallet, 1e6)));
        bytes memory sig = abi.encode(uint8(9), bytes(""), _sig(executorKey, d));
        assertEq(po.isValidSignature(d, sig), INVALID);
    }
}
