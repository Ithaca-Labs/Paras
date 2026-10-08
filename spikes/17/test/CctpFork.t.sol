// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console, Vm} from "forge-std/Test.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface ITokenMessengerV2 {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;

    function handleReceiveFinalizedMessage(uint32 remoteDomain, bytes32 sender, uint32 finalityThresholdExecuted, bytes calldata messageBody)
        external
        returns (bool);
}

/// A contract with no callbacks, standing in for a Polymarket Deposit Wallet as mintRecipient.
contract Sink {}

/// Monad half: depositForBurn(domain 7) with mintRecipient = a contract. Run with --match-contract MonadCctp --fork-url <monad rpc>.
contract MonadCctp is Test {
    address constant TM = 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    bytes32 constant MESSAGE_SENT = keccak256("MessageSent(bytes)");

    function test_burnToPolygonContractRecipient() public {
        Sink wallet = new Sink();
        deal(USDC, address(this), 1_000e6);
        IERC20(USDC).approve(TM, 1_000e6);
        vm.recordLogs();
        // standard finality (2000), maxFee 0, anyone may relay (destinationCaller = 0)
        ITokenMessengerV2(TM).depositForBurnWithHook(
            1_000e6, 7, bytes32(uint256(uint160(address(wallet)))), USDC, bytes32(0), 0, 2000, hex"70617261732d696e74656e74" // "paras-intent"
        );
        assertEq(IERC20(USDC).balanceOf(address(this)), 0, "burned");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == MESSAGE_SENT) {
                found = true;
                console.log("MessageSent bytes len", abi.decode(logs[i].data, (bytes)).length);
            }
        }
        assertTrue(found, "MessageSent emitted (Iris attests this)");
    }

    function test_fastFinalityOnMonadAllowed() public {
        // Docs: Fast Transfer N/A on Monad (standard already ~5s). Does the contract still accept 1000 with maxFee 0?
        Sink wallet = new Sink();
        deal(USDC, address(this), 10e6);
        IERC20(USDC).approve(TM, 10e6);
        try ITokenMessengerV2(TM).depositForBurn(10e6, 7, bytes32(uint256(uint160(address(wallet)))), USDC, bytes32(0), 0, 1000) {
            console.log("fast (1000) burn accepted on-chain; Iris decides whether to attest");
        } catch {
            console.log("fast (1000) burn reverted");
        }
    }
}

/// Polygon half: simulate attested delivery by impersonating MessageTransmitterV2 (what receiveMessage does after signature check).
contract PolygonCctp is Test {
    address constant TM = 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d;
    address constant MT = 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64;
    address constant USDC = 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359;
    address constant USDCE = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    address constant PUSD = 0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB;
    address constant ONRAMP = 0x93070a847efEf7F70739046A929D47a521F5B8ee;
    address constant ROUTER02 = 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45;

    function test_mintToContractRecipientThenWrapPath() public {
        Sink wallet = new Sink();
        uint256 amount = 1_000e6;
        bytes memory body = abi.encodePacked(
            uint32(1), // version
            bytes32(uint256(uint160(0x754704Bc059F8C67012fEd69BC8A327a5aafb603))), // burnToken (Monad USDC)
            bytes32(uint256(uint160(address(wallet)))), // mintRecipient
            amount,
            bytes32(uint256(uint160(address(0xBEEF)))), // messageSender (Vault on Monad)
            uint256(0), // maxFee
            uint256(0), // feeExecuted
            uint256(0), // expirationBlock
            hex"70617261732d696e74656e74" // hookData
        );
        vm.prank(MT);
        ITokenMessengerV2(TM).handleReceiveFinalizedMessage(15, bytes32(uint256(uint160(TM))), 2000, body);
        assertEq(IERC20(USDC).balanceOf(address(wallet)), amount, "native USDC minted straight to contract recipient");
        console.log("minted to contract recipient, native USDC:", IERC20(USDC).balanceOf(address(wallet)));
    }
}
