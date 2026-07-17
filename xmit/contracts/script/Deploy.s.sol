// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {xMITReputation} from "../src/xMITReputation.sol";
import {xMITTreasury} from "../src/xMITTreasury.sol";
import {xMITCore} from "../src/xMITCore.sol";
import {xMITLoyalty} from "../src/xMITLoyalty.sol";

contract DeployXMIT is Script {
    // Base mainnet USDC
    address constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    // Base Sepolia USDC (test)
    address constant USDC_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        bool isTestnet = block.chainid == 84532;
        address usdc = isTestnet ? USDC_SEPOLIA : USDC_BASE;

        console.log("Deploying xMIT to chain:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("USDC:", usdc);

        vm.startBroadcast(deployerKey);

        xMITReputation rep = new xMITReputation(deployer);
        console.log("xMITReputation:", address(rep));

        xMITTreasury treasury = new xMITTreasury(usdc, deployer);
        console.log("xMITTreasury:", address(treasury));

        xMITCore core = new xMITCore(address(rep), address(treasury), deployer);
        console.log("xMITCore:", address(core));

        xMITLoyalty loyalty = new xMITLoyalty(deployer);
        console.log("xMITLoyalty:", address(loyalty));

        // Wire up
        rep.setCoreContract(address(core));
        loyalty.setCoreContract(address(core));

        vm.stopBroadcast();

        console.log("\n=== xMIT Deployment Complete ===");
        console.log("xMITReputation :", address(rep));
        console.log("xMITTreasury   :", address(treasury));
        console.log("xMITCore       :", address(core));
        console.log("xMITLoyalty    :", address(loyalty));
        console.log("\nUpdate wrangler.toml XMIT_CONTRACT_ADDRESS with xMITCore address.");
    }
}
