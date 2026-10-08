// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vault} from "../src/Vault.sol";
import {CctpMsg} from "./Mocks.sol";
import {VaultBase} from "./Vault.t.sol";

/// Random user/executor activity. Executor calls pass through the real Vault with arbitrary arguments.
contract Handler is VaultBase {
    address[2] public actors;
    uint256[2] keys;
    address[2] public wallets;
    uint256 public ids;
    mapping(uint256 actor => bytes32[]) intentIds;
    uint256 public dispatchedTotal;
    uint256 public settledTotal;

    function init() external {
        setUp();
        actors = [alice, bob];
        keys = [aliceKey, bobKey];
        wallets = [aliceWallet, bobWallet];
        _register(aliceKey, alice, aliceWallet);
        _register(bobKey, bob, bobWallet);
    }

    function deposit(uint256 a, uint256 amt) external {
        a %= 2;
        amt = bound(amt, 1, usdc.balanceOf(actors[a]));
        vm.prank(actors[a]);
        vault.deposit(amt);
    }

    function withdraw(uint256 a, uint256 amt) external {
        a %= 2;
        (uint256 idle,,) = vault.balanceOf(actors[a]);
        if (idle == 0) return;
        vm.prank(actors[a]);
        vault.withdraw(bound(amt, 1, idle));
    }

    function submit(uint256 a, uint256 amt) external {
        a %= 2;
        (uint256 idle,,) = vault.balanceOf(actors[a]);
        if (idle == 0) return;
        bytes32 id = bytes32(++ids);
        intentIds[a].push(id);
        _submit(keys[a], _intent(actors[a], id, bound(amt, 1, idle), uint64(block.timestamp + 1 hours)));
    }

    function cancel(uint256 a, uint256 i) external {
        a %= 2;
        if (intentIds[a].length == 0) return;
        vm.prank(actors[a]);
        try vault.cancelIntent(intentIds[a][i % intentIds[a].length]) {} catch {}
    }

    function dispatch(uint256 a, uint256 i) external {
        a %= 2;
        if (intentIds[a].length == 0) return;
        bytes32 id = intentIds[a][i % intentIds[a].length];
        uint256 amt = vault.intentOf(actors[a], id).amount;
        vm.prank(executor);
        try vault.dispatch(actors[a], id) {
            dispatchedTotal += amt;
        } catch {}
    }

    /// The "other chain" returns up to a bounded amount from one of the registered wallets.
    function settle(uint256 a, uint256 i, uint256 amt, uint256 fee) external {
        a %= 2;
        amt = bound(amt, 1, 500e6);
        fee = bound(fee, 0, amt);
        bytes32 id = intentIds[a].length == 0 ? bytes32(0) : intentIds[a][i % intentIds[a].length];
        vm.prank(executor);
        try vault.settle(_returnMsg(wallets[a], amt, fee), "", id) {
            settledTotal += amt - fee;
        } catch {}
    }

    function close(uint256 a, uint256 i) external {
        a %= 2;
        if (intentIds[a].length == 0) return;
        vm.prank(executor);
        try vault.closeIntent(actors[a], intentIds[a][i % intentIds[a].length]) {} catch {}
    }

    function warp(uint256 s) external {
        vm.warp(block.timestamp + bound(s, 0, 2 hours));
    }

    function expire(uint256 a, uint256 i) external {
        a %= 2;
        if (intentIds[a].length == 0) return;
        try vault.expireIntent(actors[a], intentIds[a][i % intentIds[a].length]) {} catch {}
    }

    function sumHeld() external view returns (uint256 s, uint256 inFlight) {
        for (uint256 k; k < 2; k++) {
            (uint256 idle, uint256 reserved, uint256 f) = vault.balanceOf(actors[k]);
            s += idle + reserved;
            inFlight += f;
        }
    }

    function burnedToWallets() external view returns (uint256) {
        return tm.burnedTo(bytes32(uint256(uint160(wallets[0])))) + tm.burnedTo(bytes32(uint256(uint160(wallets[1]))));
    }
}

contract VaultInvariantTest is VaultBase {
    Handler h;

    function setUp() public override {
        h = new Handler();
        h.init();
        bytes4[] memory sels = new bytes4[](9);
        sels[0] = Handler.deposit.selector;
        sels[1] = Handler.withdraw.selector;
        sels[2] = Handler.submit.selector;
        sels[3] = Handler.cancel.selector;
        sels[4] = Handler.dispatch.selector;
        sels[5] = Handler.settle.selector;
        sels[6] = Handler.close.selector;
        sels[7] = Handler.warp.selector;
        sels[8] = Handler.expire.selector;
        targetSelector(FuzzSelector(address(h), sels));
        targetContract(address(h));
    }

    /// sum(balances) == USDC held; in-flight is tracked off-vault.
    function invariant_balancesEqualHeld() public view {
        (uint256 held, uint256 inFlight) = h.sumHeld();
        Vault v = h.vault();
        assertEq(held, v.totalBalances());
        assertEq(held, h.usdc().balanceOf(address(v)));
        assertLe(inFlight, v.totalInFlight()); // totals also cover nothing else
        assertEq(inFlight, v.totalInFlight());
    }

    /// Every burned USDC went to a registered Deposit Wallet of the intent's user, never anywhere else.
    function invariant_burnsOnlyToDepositWallets() public view {
        assertEq(h.tm().totalBurned(), h.burnedToWallets());
        assertEq(h.tm().totalBurned(), h.dispatchedTotal());
    }

    /// Value conservation: users + vault + burned == initial supply + returned mints.
    function invariant_valueConserved() public view {
        uint256 users = h.usdc().balanceOf(h.actors(0)) + h.usdc().balanceOf(h.actors(1));
        uint256 sum = users + h.usdc().balanceOf(address(h.vault())) + h.tm().totalBurned();
        assertEq(sum, 2_000e6 + h.settledTotal());
    }
}
