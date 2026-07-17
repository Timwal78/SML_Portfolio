import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // USDC on Base mainnet
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  // 1. Deploy Treasury
  const Treasury = await ethers.deployContract("xAAPTreasury", [USDC]);
  await Treasury.waitForDeployment();
  console.log("xAAPTreasury:", await Treasury.getAddress());

  // 2. Deploy Core
  const Core = await ethers.deployContract("xAAPCore", [USDC, await Treasury.getAddress()]);
  await Core.waitForDeployment();
  console.log("xAAPCore:", await Core.getAddress());

  // 3. Deploy Reputation
  const Reputation = await ethers.deployContract("xAAPReputation");
  await Reputation.waitForDeployment();
  console.log("xAAPReputation:", await Reputation.getAddress());

  // 4. Deploy Loyalty
  const Loyalty = await ethers.deployContract("xAAPLoyalty");
  await Loyalty.waitForDeployment();
  console.log("xAAPLoyalty:", await Loyalty.getAddress());

  // 5. Deploy AgentRewards
  const AgentRewards = await ethers.deployContract("xAAPAgentRewards", [USDC]);
  await AgentRewards.waitForDeployment();
  console.log("xAAPAgentRewards:", await AgentRewards.getAddress());

  // Wire up
  await Core.setReputationContract(await Reputation.getAddress());
  await Reputation.setCoreContract(await Core.getAddress());
  await Loyalty.setCoreContract(await Core.getAddress());

  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log(`XAAP_CORE_ADDRESS=${await Core.getAddress()}`);
  console.log(`XAAP_REPUTATION_ADDRESS=${await Reputation.getAddress()}`);
  console.log(`XAAP_TREASURY_ADDRESS=${await Treasury.getAddress()}`);
  console.log(`XAAP_LOYALTY_ADDRESS=${await Loyalty.getAddress()}`);
  console.log(`XAAP_AGENT_REWARDS_ADDRESS=${await AgentRewards.getAddress()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
