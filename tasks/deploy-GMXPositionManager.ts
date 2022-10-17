import { task } from "hardhat/config";

import("@nomiclabs/hardhat-ethers");

task(`deploy-GMXPositionManager`, `Deploys a GMXPositionManager contract.`)
  .addParam("token", "The token to deposit and withdraw")
  .addParam("vault", "The vault that the position manager will interact with")
  .addOptionalParam("verify", "Proceed with the Etherscan verification")
  .setAction(async ({ token, vault, verify }, localBRE) => {
    // Deployer
    const signers = await localBRE.ethers.getSigners();
    const deployer = signers[0];

    console.log(`\n- Deployer: ${deployer.address}`);

    // Native Vault
    console.log(`\n- GMXPositionManager deployment`);
    const args = [token, vault];
    const GMXPositionManager = await localBRE.ethers.getContractFactory("GMXPositionManager");

    const gmxPositionManager = await GMXPositionManager.deploy(token, vault);
    console.log(`\tDeployed GMXPositionManager at address: ${gmxPositionManager.address}\n`);

    if (verify) {
      console.log("Waiting for 30 seconds before verifying...");
      await new Promise(f => setTimeout(f, 30000));
      await localBRE.run("verify:verify", {
        address: gmxPositionManager.address,
        constructorArguments: args,
      });
    }
  });
