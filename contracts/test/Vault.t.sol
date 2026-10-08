// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Vault} from "../src/Vault.sol";
import {ITokenMessengerV2, IMessageTransmitterV2} from "../src/ICctp.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC, MockTokenMessenger, MockMessageTransmitter, CctpMsg} from "./Mocks.sol";

abstract contract VaultBase is Test {
    MockUSDC public usdc;
    MockTokenMessenger public tm;
    MockMessageTransmitter mt;
    Vault public vault;
    TimelockController timelock;

    address multisig = makeAddr("multisig");
    address executor = makeAddr("executor");
    uint256 aliceKey = 0xA11CE;
    address alice = vm.addr(aliceKey);
    uint256 bobKey = 0xB0B;
    address bob = vm.addr(bobKey);
    address aliceWallet = makeAddr("aliceWallet");
    address bobWallet = makeAddr("bobWallet");
    uint256 nonce;

    function setUp() public virtual {
        usdc = new MockUSDC();
        tm = new MockTokenMessenger(usdc);
        mt = new MockMessageTransmitter(usdc);
        address[] memory ms = new address[](1);
        ms[0] = multisig;
        timelock = new TimelockController(1 days, ms, ms, address(0));
        Vault impl = new Vault();
        vault = Vault(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(
                        Vault.initialize,
                        (
                            IERC20(address(usdc)),
                            ITokenMessengerV2(address(tm)),
                            IMessageTransmitterV2(address(mt)),
                            address(timelock),
                            multisig,
                            executor
                        )
                    )
                )
            )
        );
        for (uint256 i; i < 2; i++) {
            address u = i == 0 ? alice : bob;
            usdc.mint(u, 1_000e6);
            vm.prank(u);
            usdc.approve(address(vault), type(uint256).max);
        }
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _register(uint256 key, address user, address wallet) internal {
        bytes memory sig = _sign(key, vault.registerDigest(user, wallet));
        vm.prank(executor);
        vault.registerDepositWallet(user, wallet, sig);
    }

    function _intent(address user, bytes32 id, uint256 amount, uint64 expiry) internal pure returns (Vault.Intent memory) {
        return Vault.Intent(user, id, amount, expiry, keccak256("event:outcome"));
    }

    function _submit(uint256 key, Vault.Intent memory i) internal {
        vault.submitIntent(i, _sign(key, vault.intentDigest(i)));
    }

    /// register + deposit + submit; returns the intent.
    function _reserved(bytes32 id, uint256 amount) internal returns (Vault.Intent memory i) {
        _register(aliceKey, alice, aliceWallet);
        vm.prank(alice);
        vault.deposit(amount);
        i = _intent(alice, id, amount, uint64(block.timestamp + 1 hours));
        _submit(aliceKey, i);
    }

    function _returnMsg(address burner, uint256 amount, uint256 fee) internal returns (bytes memory) {
        return CctpMsg.encode(
            CctpMsg.Return(
                7, bytes32(++nonce), 0, bytes32(uint256(uint160(address(vault)))),
                bytes32(uint256(uint160(address(vault)))), burner, amount, fee
            ),
            address(tm)
        );
    }

    function _bal(address u) internal view returns (uint256 idle, uint256 reserved, uint256 inFlight) {
        return vault.balanceOf(u);
    }
}

contract VaultTest is VaultBase {
    bytes32 constant ID = bytes32(uint256(1));

    // ------------------------------------------------------------ deposit / withdraw
    function test_deposit() public {
        vm.prank(alice);
        vault.deposit(100e6);
        (uint256 idle,,) = _bal(alice);
        assertEq(idle, 100e6);
        assertEq(usdc.balanceOf(address(vault)), 100e6);
        assertEq(vault.totalBalances(), 100e6);
    }

    function test_deposit_zeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(Vault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_deposit_pausedReverts() public {
        vm.prank(multisig);
        vault.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.deposit(1);
    }

    function test_withdraw_idleOnly() public {
        vm.startPrank(alice);
        vault.deposit(100e6);
        vault.withdraw(40e6);
        vm.stopPrank();
        (uint256 idle,,) = _bal(alice);
        assertEq(idle, 60e6);
        assertEq(usdc.balanceOf(alice), 940e6);
    }

    function test_withdraw_cannotTouchReserved() public {
        _reserved(ID, 100e6);
        vm.prank(alice);
        vm.expectRevert(Vault.InsufficientIdle.selector);
        vault.withdraw(1);
    }

    function test_withdraw_cannotTouchOthers() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vm.prank(bob);
        vm.expectRevert(Vault.InsufficientIdle.selector);
        vault.withdraw(1);
    }

    function test_withdraw_zeroReverts() public {
        vm.expectRevert(Vault.ZeroAmount.selector);
        vault.withdraw(0);
    }

    function test_withdraw_allowedWhilePaused() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vm.prank(multisig);
        vault.pause();
        vm.prank(alice);
        vault.withdraw(100e6);
        assertEq(usdc.balanceOf(alice), 1_000e6);
    }

    // ------------------------------------------------------------ registration
    function test_register() public {
        _register(aliceKey, alice, aliceWallet);
        assertEq(vault.depositWalletOf(alice), aliceWallet);
        assertEq(vault.walletUser(aliceWallet), alice);
    }

    function test_register_badSigReverts() public {
        bytes memory sig = _sign(bobKey, vault.registerDigest(alice, aliceWallet));
        vm.prank(executor);
        vm.expectRevert(Vault.BadSignature.selector);
        vault.registerDepositWallet(alice, aliceWallet, sig);
    }

    function test_register_sigBoundToWallet() public {
        bytes memory sig = _sign(aliceKey, vault.registerDigest(alice, aliceWallet));
        vm.prank(executor);
        vm.expectRevert(Vault.BadSignature.selector);
        vault.registerDepositWallet(alice, bobWallet, sig);
    }

    function test_register_onlyExecutor() public {
        bytes memory sig = _sign(aliceKey, vault.registerDigest(alice, aliceWallet));
        vm.expectRevert();
        vault.registerDepositWallet(alice, aliceWallet, sig);
    }

    function test_register_onlyOnce() public {
        _register(aliceKey, alice, aliceWallet);
        bytes memory sig = _sign(aliceKey, vault.registerDigest(alice, bobWallet));
        vm.prank(executor);
        vm.expectRevert(Vault.AlreadyRegistered.selector);
        vault.registerDepositWallet(alice, bobWallet, sig);
    }

    function test_register_walletTakenReverts() public {
        _register(aliceKey, alice, aliceWallet);
        bytes memory sig = _sign(bobKey, vault.registerDigest(bob, aliceWallet));
        vm.prank(executor);
        vm.expectRevert(Vault.AlreadyRegistered.selector);
        vault.registerDepositWallet(bob, aliceWallet, sig);
    }

    // ------------------------------------------------------------ intents
    function test_submit_reservesAndAnyoneCanRelay() public {
        Vault.Intent memory i = _reserved(ID, 100e6); // relayed by this test contract
        (uint256 idle, uint256 reserved,) = _bal(alice);
        assertEq(idle, 0);
        assertEq(reserved, 100e6);
        Vault.IntentState memory s = vault.intentOf(alice, ID);
        assertEq(uint8(s.status), uint8(Vault.Status.Reserved));
        assertEq(s.amount, i.amount);
    }

    function test_submit_unregisteredReverts() public {
        vm.prank(alice);
        vault.deposit(10e6);
        Vault.Intent memory i = _intent(alice, ID, 10e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(aliceKey, vault.intentDigest(i));
        vm.expectRevert(Vault.NotRegistered.selector);
        vault.submitIntent(i, sig);
    }

    function test_submit_wrongSignerReverts() public {
        _register(aliceKey, alice, aliceWallet);
        vm.prank(alice);
        vault.deposit(10e6);
        Vault.Intent memory i = _intent(alice, ID, 10e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(bobKey, vault.intentDigest(i));
        vm.expectRevert(Vault.BadSignature.selector);
        vault.submitIntent(i, sig);
    }

    function test_submit_tamperedAmountReverts() public {
        _register(aliceKey, alice, aliceWallet);
        vm.prank(alice);
        vault.deposit(10e6);
        Vault.Intent memory i = _intent(alice, ID, 5e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(aliceKey, vault.intentDigest(i));
        i.amount = 10e6;
        vm.expectRevert(Vault.BadSignature.selector);
        vault.submitIntent(i, sig);
    }

    function test_submit_expiredReverts() public {
        _register(aliceKey, alice, aliceWallet);
        vm.prank(alice);
        vault.deposit(10e6);
        Vault.Intent memory i = _intent(alice, ID, 10e6, uint64(block.timestamp));
        bytes memory sig = _sign(aliceKey, vault.intentDigest(i));
        vm.expectRevert(Vault.Expired.selector);
        vault.submitIntent(i, sig);
    }

    function test_submit_replayReverts() public {
        Vault.Intent memory i = _reserved(ID, 10e6);
        bytes memory sig = _sign(aliceKey, vault.intentDigest(i));
        vm.expectRevert(Vault.WrongStatus.selector);
        vault.submitIntent(i, sig);
    }

    function test_submit_insufficientIdleReverts() public {
        _register(aliceKey, alice, aliceWallet);
        Vault.Intent memory i = _intent(alice, ID, 10e6, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(aliceKey, vault.intentDigest(i));
        vm.expectRevert(Vault.InsufficientIdle.selector);
        vault.submitIntent(i, sig);
    }

    function test_submit_zeroAmountReverts() public {
        _register(aliceKey, alice, aliceWallet);
        Vault.Intent memory i = _intent(alice, ID, 0, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(aliceKey, vault.intentDigest(i));
        vm.expectRevert(Vault.ZeroAmount.selector);
        vault.submitIntent(i, sig);
    }

    function test_cancel_releasesToIdle() public {
        _reserved(ID, 100e6);
        vm.prank(alice);
        vault.cancelIntent(ID);
        (uint256 idle, uint256 reserved,) = _bal(alice);
        assertEq(idle, 100e6);
        assertEq(reserved, 0);
        assertEq(uint8(vault.intentOf(alice, ID).status), uint8(Vault.Status.Cancelled));
    }

    function test_cancel_onlyOwnerAndOnlyReserved() public {
        _reserved(ID, 100e6);
        vm.prank(bob);
        vm.expectRevert(Vault.WrongStatus.selector);
        vault.cancelIntent(ID);
        vm.prank(alice);
        vault.cancelIntent(ID);
        vm.prank(alice);
        vm.expectRevert(Vault.WrongStatus.selector);
        vault.cancelIntent(ID);
    }

    function test_expire() public {
        Vault.Intent memory i = _reserved(ID, 100e6);
        vm.expectRevert(Vault.NotExpired.selector);
        vault.expireIntent(alice, ID);
        vm.warp(i.expiry + 1);
        vault.expireIntent(alice, ID);
        (uint256 idle, uint256 reserved,) = _bal(alice);
        assertEq(idle, 100e6);
        assertEq(reserved, 0);
        assertEq(uint8(vault.intentOf(alice, ID).status), uint8(Vault.Status.Expired));
    }

    function test_expire_unknownIntentReverts() public {
        vm.warp(block.timestamp + 10);
        vm.expectRevert(Vault.WrongStatus.selector);
        vault.expireIntent(alice, ID);
    }

    // ------------------------------------------------------------ dispatch
    function test_dispatch_burnsToRegisteredWalletOnly() public {
        _reserved(ID, 100e6);
        vm.prank(executor);
        vault.dispatch(alice, ID);
        assertEq(tm.lastDomain(), 7);
        assertEq(tm.lastRecipient(), bytes32(uint256(uint160(aliceWallet))));
        assertEq(tm.lastCaller(), bytes32(0));
        assertEq(tm.lastMaxFee(), 0);
        assertEq(tm.lastFinality(), 2000);
        assertEq(tm.burnedTo(bytes32(uint256(uint160(aliceWallet)))), 100e6);
        (uint256 idle, uint256 reserved, uint256 inFlight) = _bal(alice);
        assertEq(idle + reserved, 0);
        assertEq(inFlight, 100e6);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(vault.totalInFlight(), 100e6);
        assertEq(uint8(vault.intentOf(alice, ID).status), uint8(Vault.Status.Dispatched));
    }

    function test_dispatch_onlyExecutor() public {
        _reserved(ID, 100e6);
        vm.prank(alice);
        vm.expectRevert();
        vault.dispatch(alice, ID);
    }

    function test_dispatch_twiceReverts() public {
        _reserved(ID, 100e6);
        vm.startPrank(executor);
        vault.dispatch(alice, ID);
        vm.expectRevert(Vault.WrongStatus.selector);
        vault.dispatch(alice, ID);
        vm.stopPrank();
    }

    function test_dispatch_cancelledReverts() public {
        _reserved(ID, 100e6);
        vm.prank(alice);
        vault.cancelIntent(ID);
        vm.prank(executor);
        vm.expectRevert(Vault.WrongStatus.selector);
        vault.dispatch(alice, ID);
    }

    function test_dispatch_expiredReverts() public {
        Vault.Intent memory i = _reserved(ID, 100e6);
        vm.warp(i.expiry + 1);
        vm.prank(executor);
        vm.expectRevert(Vault.Expired.selector);
        vault.dispatch(alice, ID);
    }

    function test_dispatch_pausedReverts() public {
        _reserved(ID, 100e6);
        vm.prank(multisig);
        vault.pause();
        vm.prank(executor);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.dispatch(alice, ID);
    }

    // ------------------------------------------------------------ settle
    function _dispatched(uint256 amount) internal {
        _reserved(ID, amount);
        vm.prank(executor);
        vault.dispatch(alice, ID);
    }

    function test_settle_creditsBurnerUserAndReducesInFlight() public {
        _dispatched(100e6);
        bytes memory m = _returnMsg(aliceWallet, 150e6, 0); // winning bet
        vm.prank(executor);
        vault.settle(m, "", ID);
        (uint256 idle,, uint256 inFlight) = _bal(alice);
        assertEq(idle, 150e6);
        assertEq(inFlight, 0);
        assertEq(usdc.balanceOf(address(vault)), 150e6);
        assertEq(vault.totalBalances(), 150e6);
        assertEq(vault.totalInFlight(), 0);
    }

    function test_settle_partialThenClose() public {
        _dispatched(100e6);
        vm.startPrank(executor);
        vault.settle(_returnMsg(aliceWallet, 30e6, 0), "", ID);
        (uint256 idle,, uint256 inFlight) = _bal(alice);
        assertEq(idle, 30e6);
        assertEq(inFlight, 70e6);
        vault.closeIntent(alice, ID); // losing remainder
        vm.stopPrank();
        (,, inFlight) = _bal(alice);
        assertEq(inFlight, 0);
        assertEq(vault.totalInFlight(), 0);
        assertEq(uint8(vault.intentOf(alice, ID).status), uint8(Vault.Status.Closed));
    }

    function test_settle_withoutIntentIdKeepsInFlight() public {
        _dispatched(100e6);
        vm.prank(executor);
        vault.settle(_returnMsg(aliceWallet, 40e6, 0), "", bytes32(0));
        (uint256 idle,, uint256 inFlight) = _bal(alice);
        assertEq(idle, 40e6);
        assertEq(inFlight, 100e6);
    }

    function test_settle_creditsNetOfFee() public {
        _dispatched(100e6);
        vm.prank(executor);
        vault.settle(_returnMsg(aliceWallet, 100e6, 1e6), "", ID);
        (uint256 idle,,) = _bal(alice);
        assertEq(idle, 99e6);
    }

    function test_settle_creditsOnlyBurnersUser() public {
        _dispatched(100e6);
        _register(bobKey, bob, bobWallet);
        vm.prank(executor);
        vault.settle(_returnMsg(bobWallet, 5e6, 0), "", bytes32(0));
        (uint256 aIdle,,) = _bal(alice);
        (uint256 bIdle,,) = _bal(bob);
        assertEq(aIdle, 0);
        assertEq(bIdle, 5e6);
    }

    function test_settle_intentOfAnotherUserReverts() public {
        _dispatched(100e6);
        _register(bobKey, bob, bobWallet);
        bytes memory m = _returnMsg(bobWallet, 5e6, 0);
        vm.prank(executor);
        vm.expectRevert(Vault.WrongStatus.selector);
        vault.settle(m, "", ID); // alice's intent id, bob's credit
    }

    function test_settle_unknownBurnerReverts() public {
        bytes memory m = _returnMsg(makeAddr("stranger"), 5e6, 0);
        vm.prank(executor);
        vm.expectRevert(Vault.NotRegistered.selector);
        vault.settle(m, "", bytes32(0));
    }

    function test_settle_replayReverts() public {
        _dispatched(100e6);
        bytes memory m = _returnMsg(aliceWallet, 5e6, 0);
        vm.startPrank(executor);
        vault.settle(m, "", bytes32(0));
        vm.expectRevert("nonce");
        vault.settle(m, "", bytes32(0));
        vm.stopPrank();
    }

    function test_settle_onlyExecutor() public {
        _dispatched(100e6);
        bytes memory m = _returnMsg(aliceWallet, 5e6, 0);
        vm.expectRevert();
        vault.settle(m, "", bytes32(0));
    }

    function test_settle_rejectsForeignMessages() public {
        _dispatched(100e6);
        bytes32 vault32 = bytes32(uint256(uint160(address(vault))));
        bytes32 other = bytes32(uint256(1));
        CctpMsg.Return memory r =
            CctpMsg.Return(7, bytes32(uint256(901)), 0, vault32, vault32, aliceWallet, 5e6, 0);
        // wrong source domain
        r.sourceDomain = 1;
        _expectBadMessage(CctpMsg.encode(r, address(tm)));
        r.sourceDomain = 7;
        // sender is not the TokenMessenger
        r.sender = other;
        _expectBadMessage(CctpMsg.encode(r, address(tm)));
        r.sender = 0;
        // anyone-can-relay message (destinationCaller 0)
        r.destinationCaller = 0;
        _expectBadMessage(CctpMsg.encode(r, address(tm)));
        r.destinationCaller = vault32;
        // minted somewhere other than the Vault
        r.mintRecipient = other;
        _expectBadMessage(CctpMsg.encode(r, address(tm)));
        // too short
        _expectBadMessage(hex"01");
    }

    function _expectBadMessage(bytes memory m) internal {
        vm.prank(executor);
        vm.expectRevert(Vault.BadMessage.selector);
        vault.settle(m, "", bytes32(0));
    }

    function test_close_onlyExecutorAndDispatched() public {
        _reserved(ID, 10e6);
        vm.prank(executor);
        vm.expectRevert(Vault.WrongStatus.selector);
        vault.closeIntent(alice, ID);
        vm.prank(executor);
        vault.dispatch(alice, ID);
        vm.prank(alice);
        vm.expectRevert();
        vault.closeIntent(alice, ID);
    }

    // ------------------------------------------------------------ operations
    function test_pause_onlyPauser() public {
        vm.expectRevert();
        vault.pause();
        vm.prank(multisig);
        vault.pause();
        assertTrue(vault.paused());
    }

    function test_unpause_onlyAdmin_viaTimelockDelay() public {
        vm.prank(multisig);
        vault.pause();
        vm.prank(multisig);
        vm.expectRevert();
        vault.unpause(); // pauser cannot unpause
        bytes memory data = abi.encodeCall(Vault.unpause, ());
        vm.startPrank(multisig);
        timelock.schedule(address(vault), 0, data, 0, 0, 1 days);
        vm.expectRevert();
        timelock.execute(address(vault), 0, data, 0, 0); // too early
        vm.warp(block.timestamp + 1 days);
        timelock.execute(address(vault), 0, data, 0, 0);
        vm.stopPrank();
        assertFalse(vault.paused());
    }

    function test_upgrade_onlyAdmin() public {
        Vault impl2 = new Vault();
        vm.prank(multisig);
        vm.expectRevert();
        vault.upgradeToAndCall(address(impl2), "");
        // via timelock
        vm.startPrank(multisig);
        bytes memory data = abi.encodeCall(vault.upgradeToAndCall, (address(impl2), ""));
        timelock.schedule(address(vault), 0, data, 0, 0, 1 days);
        vm.warp(block.timestamp + 1 days);
        timelock.execute(address(vault), 0, data, 0, 0);
        vm.stopPrank();
        assertEq(vm.load(address(vault), 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc), bytes32(uint256(uint160(address(impl2)))));
    }

    function test_roleGrants_onlyAdmin() public {
        bytes32 role = vault.EXECUTOR_ROLE();
        vm.prank(multisig);
        vm.expectRevert();
        vault.grantRole(role, bob);
    }

    function test_implementationCannotBeInitialized() public {
        Vault impl = new Vault();
        vm.expectRevert();
        impl.initialize(
            IERC20(address(usdc)), ITokenMessengerV2(address(tm)), IMessageTransmitterV2(address(mt)), bob, bob, bob
        );
    }

    function test_initializeOnlyOnce() public {
        vm.expectRevert();
        vault.initialize(
            IERC20(address(usdc)), ITokenMessengerV2(address(tm)), IMessageTransmitterV2(address(mt)), bob, bob, bob
        );
    }
}
