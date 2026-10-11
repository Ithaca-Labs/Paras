// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DemoCctp} from "../src/DemoCctp.sol";
import {MockUSDC, CctpMsg} from "./Mocks.sol";

contract DemoCctpTest is Test {
    MockUSDC usdc;
    DemoCctp cctp;
    uint256 attesterKey = 0xA77E;
    address vault = makeAddr("vault");

    function setUp() public {
        vm.chainId(10143);
        usdc = new MockUSDC();
        cctp = new DemoCctp(IERC20(address(usdc)), vm.addr(attesterKey));
        usdc.mint(vault, 100e6);
        vm.prank(vault);
        usdc.approve(address(cctp), 100e6);
    }

    function _msg(bytes32 nonce, uint256 amount) internal view returns (bytes memory) {
        return CctpMsg.encode(
            CctpMsg.Return(
                CctpMsg.POLYGON,
                nonce,
                0,
                bytes32(uint256(uint160(vault))),
                bytes32(uint256(uint160(vault))),
                address(1),
                amount,
                0
            ),
            address(cctp)
        );
    }

    function _att(bytes memory m, uint256 key) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(m));
        return abi.encodePacked(r, s, v);
    }

    function test_escrowThenPayout() public {
        vm.prank(vault);
        cctp.depositForBurn(40e6, 7, bytes32(0), address(usdc), bytes32(0), 0, 2000);
        bytes memory m = _msg(bytes32(uint256(1)), 30e6);
        vm.prank(vault);
        assertTrue(cctp.receiveMessage(m, _att(m, attesterKey)));
        assertEq(usdc.balanceOf(vault), 90e6);
        assertEq(cctp.usedNonces(bytes32(uint256(1))), 1);
    }

    function test_rejectsReplayStrangerSignerAndCaller() public {
        vm.prank(vault);
        cctp.depositForBurn(40e6, 7, bytes32(0), address(usdc), bytes32(0), 0, 2000);
        bytes memory m = _msg(bytes32(uint256(1)), 30e6);
        bytes memory good = _att(m, attesterKey);
        vm.prank(vault);
        cctp.receiveMessage(m, good);
        vm.startPrank(vault);
        vm.expectRevert(DemoCctp.BadMessage.selector);
        cctp.receiveMessage(m, good); // replay
        bytes memory m2 = _msg(bytes32(uint256(2)), 5e6);
        bytes memory forged = _att(m2, 0xBAD);
        vm.expectRevert(DemoCctp.BadMessage.selector);
        cctp.receiveMessage(m2, forged); // not the attester
        vm.stopPrank();
        bytes memory ok = _att(m2, attesterKey);
        vm.expectRevert(DemoCctp.BadMessage.selector);
        cctp.receiveMessage(m2, ok); // caller is not destinationCaller
    }

    function test_onlyMonadTestnet() public {
        vm.chainId(143);
        vm.expectRevert(DemoCctp.WrongChain.selector);
        new DemoCctp(IERC20(address(usdc)), address(1));
    }
}
