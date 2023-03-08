import { task } from "hardhat/config";

import("@nomiclabs/hardhat-ethers");

task(`deploy-AlphaVaultMigratooor`, `Deploys an AlphaVault contract.`)
  .addParam("token", "The base token of both vaults.")
  .addParam("oldvault", "The vault to withdraw from.")
  .addParam("newvault", "The vault to deposit into.")
  .addOptionalParam("verify", "Proceed with the Etherscan verification")
  .setAction(async ({ token, oldvault, newvault, verify }, localBRE) => {
    // Deployer
    const signers = await localBRE.ethers.getSigners();
    const deployer = signers[0];

    console.log(`\n- Deployer: ${deployer.address}`);

    // Native Vault
    console.log(`\n- AlphaVaultMigratooor deployment`);
    const args = [token, oldvault, newvault];
    const AlphaVaultMigratoooor = await localBRE.ethers.getContractFactory("AlphaVaultMigratooor");

    const alphaVaultMigratooor = await localBRE.upgrades.deployProxy(AlphaVaultMigratoooor, args);
    console.log(`\tDeployed AlphaVaultMigratooor at address: ${alphaVaultMigratooor.address}\n`);

    if (verify) {
      console.log("Waiting for 30 seconds before verifying...");
      await new Promise(f => setTimeout(f, 30000));
      await localBRE.run("verify:verify", {
        address: alphaVaultMigratooor.address,
        constructorArguments: [],
      });
    }
  });
