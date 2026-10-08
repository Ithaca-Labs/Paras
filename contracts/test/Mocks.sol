// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ITokenMessengerV2, IMessageTransmitterV2} from "../src/ICctp.sol";

contract MockUSDC is ERC20("USD Coin", "USDC") {
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

/// Burns USDC and records where it was addressed. No cross-chain delivery (tests craft return messages).
contract MockTokenMessenger is ITokenMessengerV2 {
    MockUSDC public immutable usdc;
    uint256 public totalBurned;
    mapping(bytes32 recipient => uint256) public burnedTo;
    uint32 public lastDomain;
    bytes32 public lastRecipient;
    bytes32 public lastCaller;
    uint256 public lastMaxFee;
    uint32 public lastFinality;

    constructor(MockUSDC u) {
        usdc = u;
    }

    function depositForBurn(uint256 amount, uint32 d, bytes32 r, address token, bytes32 c, uint256 maxFee, uint32 fin)
        external
    {
        require(token == address(usdc), "token");
        usdc.transferFrom(msg.sender, address(this), amount);
        totalBurned += amount;
        burnedTo[r] += amount;
        (lastDomain, lastRecipient, lastCaller, lastMaxFee, lastFinality) = (d, r, c, maxFee, fin);
    }
}

/// Mirrors the real transmitter's observable behavior: destinationCaller must be the caller, one-shot nonces,
/// then mints `amount - feeExecuted` to the burn message's mintRecipient.
contract MockMessageTransmitter is IMessageTransmitterV2 {
    MockUSDC public immutable usdc;
    mapping(bytes32 => bool) public used;

    constructor(MockUSDC u) {
        usdc = u;
    }

    function receiveMessage(bytes calldata m, bytes calldata) external returns (bool) {
        require(bytes32(m[108:140]) == bytes32(uint256(uint160(msg.sender))), "caller");
        bytes32 nonce = bytes32(m[12:44]);
        require(!used[nonce], "nonce");
        used[nonce] = true;
        bytes calldata b = m[148:];
        usdc.mint(address(uint160(uint256(bytes32(b[36:68])))), uint256(bytes32(b[68:100])) - uint256(bytes32(b[164:196])));
        return true;
    }
}

library CctpMsg {
    uint32 constant POLYGON = 7;
    uint32 constant MONAD = 15;

    struct Return {
        uint32 sourceDomain;
        bytes32 nonce;
        bytes32 sender; // TokenMessenger
        bytes32 destinationCaller;
        bytes32 mintRecipient;
        address burner;
        uint256 amount;
        uint256 feeExecuted;
    }

    function encode(Return memory r, address tm) internal pure returns (bytes memory) {
        bytes32 tm32 = bytes32(uint256(uint160(tm)));
        bytes32 sender = r.sender == 0 ? tm32 : r.sender;
        bytes memory head = abi.encodePacked(uint32(1), r.sourceDomain, MONAD, r.nonce, sender, tm32);
        head = abi.encodePacked(head, r.destinationCaller, uint32(2000), uint32(2000));
        bytes memory body = abi.encodePacked(uint32(1), bytes32(0), r.mintRecipient, r.amount);
        body = abi.encodePacked(body, bytes32(uint256(uint160(r.burner))), uint256(0), r.feeExecuted, uint256(0));
        return abi.encodePacked(head, body);
    }
}
