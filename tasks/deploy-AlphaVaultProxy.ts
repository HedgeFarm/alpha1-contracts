import { task } from "hardhat/config";

import("@nomiclabs/hardhat-ethers");

task(`deploy-AlphaVaultProxy`, `Deploys an AlphaVault contract.`)
  .addParam("name", "The name of the IOU")
  .addParam("symbol", "The symbol of the IOU")
  .addParam("token", "The token to deposit and withdraw")
  .addParam("manager", "The safe in charge of start/stop/managing positions")
  .addParam("feerecipient", "The recipient of the performance and management fee")
  .addParam("cap", "Maximum cap * 1e18 decimals")
  .addOptionalParam("verify", "Proceed with the Etherscan verification")
  .setAction(async ({ name, symbol, token, manager, feerecipient, cap, verify }, localBRE) => {
    // Deployer
    const signers = await localBRE.ethers.getSigners();
    const deployer = signers[0];

    console.log(`\n- Deployer: ${deployer.address}`);

    // Native Vault
    console.log(`\n- AlphaVaultProxy deployment`);
    const args = [name, symbol, token, manager, feerecipient, cap];
    const AlphaVaultProxy = await localBRE.ethers.getContractFactory("AlphaVaultProxy");

    const alphaVaultProxy = await localBRE.upgrades.deployProxy(AlphaVaultProxy, args);
    console.log(`\tDeployed AlphaVaultProxy at address: ${alphaVaultProxy.address}\n`);

    if (verify) {
      console.log("Waiting for 30 seconds before verifying...");
      await new Promise(f => setTimeout(f, 30000));
      await localBRE.run("verify:verify", {
        address: alphaVaultProxy.address,
        constructorArguments: [],
      });
    }
  });
