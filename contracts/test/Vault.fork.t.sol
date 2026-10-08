// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vault} from "../src/Vault.sol";
import {ITokenMessengerV2, IMessageTransmitterV2} from "../src/ICctp.sol";

interface IAttestable {
    function attesterManager() external view returns (address);
    function enableAttester(address) external;
    function setSignatureThreshold(uint256) external;
}

/// Vault against the real CCTP v2 contracts on Monad mainnet. Skipped unless MONAD_RPC_URL is set (CI is offline).
///   MONAD_RPC_URL=https://rpc.monad.xyz forge test --match-contract VaultForkTest
contract VaultForkTest is Test {
    address constant TM = 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d;
    address constant MT = 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant POLYGON_USDC = 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359;
    bytes32 constant MESSAGE_SENT = keccak256("MessageSent(bytes)");

    Vault vault;
    address executor = makeAddr("executor");
    address wallet = makeAddr("depositWallet");
    uint256 key = 0xA11CE;
    address alice = vm.addr(key);

    function setUp() public {
        string memory rpc = vm.envOr("MONAD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        Vault impl = new Vault();
        vault = Vault(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(
                        Vault.initialize,
                        (
                            IERC20(USDC),
                            ITokenMessengerV2(TM),
                            IMessageTransmitterV2(MT),
                            makeAddr("timelock"),
                            makeAddr("multisig"),
                            executor
                        )
                    )
                )
            )
        );
    }

    function _sign(uint256 k, bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(k, d);
        return abi.encodePacked(r, s, v);
    }

    function _register() internal {
        bytes memory sig = _sign(key, vault.registerDigest(alice, wallet));
        vm.prank(executor);
        vault.registerDepositWallet(alice, wallet, sig);
    }

    function test_dispatchBurnsOnRealCctpToDepositWallet() public {
        deal(USDC, alice, 100e6);
        vm.startPrank(alice);
        IERC20(USDC).approve(address(vault), 100e6);
        vault.deposit(100e6);
        vm.stopPrank();
        _register();
        Vault.Intent memory i = Vault.Intent(alice, bytes32(uint256(1)), 100e6, uint64(block.timestamp + 1 hours), 0);
        vault.submitIntent(i, _sign(key, vault.intentDigest(i)));

        vm.recordLogs();
        vm.prank(executor);
        vault.dispatch(alice, i.id);

        assertEq(IERC20(USDC).balanceOf(address(vault)), 0, "burned");
        (uint256 idle, uint256 reserved, uint256 inFlight) = vault.balanceOf(alice);
        assertEq(idle + reserved, 0);
        assertEq(inFlight, 100e6);
        // MessageSent carries domain 7 and mintRecipient = the wallet (BurnMessageV2 body at header offset 148).
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 k; k < logs.length; k++) {
            if (logs[k].topics[0] != MESSAGE_SENT) continue;
            bytes memory m = abi.decode(logs[k].data, (bytes));
            assertEq(uint32(bytes4(_slice(m, 8, 4))), 7, "destination domain");
            assertEq(bytes32(_slice(m, 108, 32)), bytes32(0), "anyone can relay");
            assertEq(bytes32(_slice(m, 148 + 36, 32)), bytes32(uint256(uint160(wallet))), "mintRecipient");
            found = true;
        }
        assertTrue(found, "MessageSent");
    }

    /// Return leg: a Polygon burn (src domain 7) with mintRecipient = destinationCaller = Vault, attested by a test
    /// attester we enable on the fork. Real MessageTransmitterV2 + TokenMessengerV2 + TokenMinter mint into the Vault.
    function test_settleConsumesRealAttestedMessage() public {
        _register();

        uint256 attesterKey = 0xA77E57;
        address attester = vm.addr(attesterKey);
        address mgr = IAttestable(MT).attesterManager();
        vm.startPrank(mgr);
        IAttestable(MT).enableAttester(attester);
        IAttestable(MT).setSignatureThreshold(1);
        vm.stopPrank();

        bytes32 tm32 = bytes32(uint256(uint160(TM)));
        bytes32 v32 = bytes32(uint256(uint160(address(vault))));
        bytes memory head = abi.encodePacked(
            uint32(1), uint32(7), uint32(15), keccak256("nonce-1"), tm32, tm32, v32, uint32(2000), uint32(2000)
        );
        bytes memory body = abi.encodePacked(
            uint32(1), bytes32(uint256(uint160(POLYGON_USDC))), v32, uint256(120e6), bytes32(uint256(uint160(wallet))),
            uint256(0), uint256(0), uint256(0)
        );
        bytes memory m = abi.encodePacked(head, body);
        bytes memory att = _sign(attesterKey, keccak256(m));

        vm.prank(executor);
        vault.settle(m, att, bytes32(0));

        (uint256 idle,,) = vault.balanceOf(alice);
        assertEq(idle, 120e6);
        assertEq(IERC20(USDC).balanceOf(address(vault)), 120e6);
        assertEq(vault.totalBalances(), 120e6);

        // Replay is rejected by the real transmitter.
        vm.prank(executor);
        vm.expectRevert();
        vault.settle(m, att, bytes32(0));

        // User withdraws.
        vm.prank(alice);
        vault.withdraw(120e6);
        assertEq(IERC20(USDC).balanceOf(alice), 120e6);
    }

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 k; k < len; k++) out[k] = b[start + k];
    }
}
