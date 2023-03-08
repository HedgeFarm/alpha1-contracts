import { task } from "hardhat/config";

import("@nomiclabs/hardhat-ethers");

task(`upgrade-AlphaVault`, `Deploys an AlphaVault contract.`)
  .addOptionalParam("verify", "Proceed with the Etherscan verification")
  .setAction(async ({ name, symbol, token, manager, feerecipient, cap, verify }, localBRE) => {
    // Deployer
    const signers = await localBRE.ethers.getSigners();
    const deployer = signers[0];

    console.log(`\n- Deployer: ${deployer.address}`);

    // Native Vault
    console.log(`\n- AlphaVault deployment`);
    const AlphaVault = await localBRE.ethers.getContractFactory("AlphaVault");

    // No parameters new instance of AlphaVault is deployed to which later we will upgrade our proxy in Defender
    const alphaVault = await AlphaVault.deploy();
    console.log(`\tDeployed AlphaVault at address: ${alphaVault.address}\n`);

    if (verify) {
      console.log("Waiting for 30 seconds before verifying...");
      await new Promise(f => setTimeout(f, 30000));
      await localBRE.run("verify:verify", {
        address: alphaVault.address,
      });
    }
  });
