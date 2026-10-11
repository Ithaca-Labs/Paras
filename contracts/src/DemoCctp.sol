// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ITokenMessengerV2, IMessageTransmitterV2} from "./ICctp.sol";

/// TESTNET DEMO ONLY. Stands in for CCTP's TokenMessenger AND MessageTransmitter so the Vault can run end to end
/// while the Polygon leg is simulated (#98): `depositForBurn` escrows USDC, `receiveMessage` pays it back out
/// against a message signed by `attester` (the demo Executor). Refuses to deploy anywhere but Monad testnet.
contract DemoCctp is ITokenMessengerV2, IMessageTransmitterV2 {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public immutable attester;
    mapping(bytes32 nonce => uint256) public usedNonces;

    event DemoBurn(address indexed burner, uint256 amount, uint32 destinationDomain, bytes32 mintRecipient);

    error WrongChain();
    error BadMessage();

    constructor(IERC20 u, address a) {
        if (block.chainid != 10143) revert WrongChain();
        (usdc, attester) = (u, a);
    }

    function depositForBurn(uint256 amount, uint32 domain, bytes32 recipient, address token, bytes32, uint256, uint32)
        external
    {
        if (token != address(usdc)) revert BadMessage();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit DemoBurn(msg.sender, amount, domain, recipient);
    }

    /// Same checks the Vault relies on in the real transmitter: caller is the destinationCaller, one-shot nonce.
    function receiveMessage(bytes calldata m, bytes calldata attestation) external returns (bool) {
        if (m.length < 148 + 228 || bytes32(m[108:140]) != bytes32(uint256(uint160(msg.sender)))) revert BadMessage();
        if (ECDSA.recover(keccak256(m), attestation) != attester) revert BadMessage();
        bytes32 nonce = bytes32(m[12:44]);
        if (usedNonces[nonce] != 0) revert BadMessage();
        usedNonces[nonce] = 1;
        bytes calldata b = m[148:];
        usdc.safeTransfer(
            address(uint160(uint256(bytes32(b[36:68])))), uint256(bytes32(b[68:100])) - uint256(bytes32(b[164:196]))
        );
        return true;
    }
}
