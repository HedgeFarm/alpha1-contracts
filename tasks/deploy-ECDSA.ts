import { task } from "hardhat/config";

import("@nomiclabs/hardhat-ethers");

task(`deploy-ECDSA`, `Deploys a ECDSA library.`)
  .addOptionalParam("verify", "Proceed with the Etherscan verification")
  .setAction(async ({ token, vault, verify }, localBRE) => {
    // Deployer
    const signers = await localBRE.ethers.getSigners();
    const deployer = signers[0];

    console.log(`\n- Deployer: ${deployer.address}`);

    // Native Vault
    console.log(`\n- ECDSA deployment`);
    const ECDSA = await localBRE.ethers.getContractFactory("ECDSA");

    const ecdsa = await ECDSA.deploy();
    console.log(`\tDeployed ECDSA at address: ${ecdsa.address}\n`);

    if (verify) {
      console.log("Waiting for 30 seconds before verifying...");
      await new Promise(f => setTimeout(f, 30000));
      await localBRE.run("verify:verify", {
        address: ecdsa.address,
      });
    }
  });
