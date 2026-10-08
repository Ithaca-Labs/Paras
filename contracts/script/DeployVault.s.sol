// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vault} from "../src/Vault.sol";
import {ITokenMessengerV2, IMessageTransmitterV2} from "../src/ICctp.sol";

/// Monad testnet (10143) defaults; override with env for mainnet (addresses: PRD > Vault risk findings).
///   MULTISIG=0x.. EXECUTOR=0x.. forge script script/DeployVault.s.sol --rpc-url $MONAD_RPC_URL --broadcast --private-key $DEPLOYER_KEY
/// The deployer keeps no role: the Timelock (proposer/executor = MULTISIG) is Vault admin, MULTISIG is pauser.
contract DeployVault is Script {
    function run() external returns (Vault vault, TimelockController timelock) {
        address usdc = vm.envOr("USDC", address(0x534b2f3A21130d7a60830c2Df862319e593943A3));
        address tm = vm.envOr("TOKEN_MESSENGER", address(0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA));
        address mt = vm.envOr("MESSAGE_TRANSMITTER", address(0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275));
        address multisig = vm.envAddress("MULTISIG");
        address executor = vm.envAddress("EXECUTOR");
        uint256 delay = vm.envOr("TIMELOCK_DELAY", uint256(1 hours)); // mainnet: >= 24h

        vm.startBroadcast();
        address[] memory ms = new address[](1);
        ms[0] = multisig;
        timelock = new TimelockController(delay, ms, ms, address(0));
        Vault impl = new Vault();
        vault = Vault(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(
                        Vault.initialize,
                        (IERC20(usdc), ITokenMessengerV2(tm), IMessageTransmitterV2(mt), address(timelock), multisig, executor)
                    )
                )
            )
        );
        vm.stopBroadcast();
        console.log("Timelock", address(timelock));
        console.log("Vault impl", address(impl));
        console.log("Vault proxy", address(vault));
    }
}
