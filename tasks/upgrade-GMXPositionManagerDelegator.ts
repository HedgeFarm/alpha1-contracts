import { task } from "hardhat/config";
import("@nomiclabs/hardhat-ethers");

task(`upgrade-GMXPositionManagerDelegator`, `Upgrades a GMXPositionManager contract.`)
  .addOptionalParam("verify", "Proceed with the Etherscan verification")
  .setAction(async ({ token, vault, manager, verify }, localBRE) => {
    // Deployer
    const signers = await localBRE.ethers.getSigners();
    const deployer = signers[0];

    console.log(`\n- Deployer: ${deployer.address}`);

    // GMXPositionManagerDelegator
    console.log(`\n- GMXPositionManager deployment`);
    const GMXPositionManagerDelegatorV2 = await localBRE.ethers.getContractFactory("GMXPositionManagerDelegatorV2");
    const gmxPositionManagerDelegatorV2 = await GMXPositionManagerDelegatorV2.deploy();

    if (verify) {
      console.log("Waiting for 30 seconds before verifying...");
      await new Promise(f => setTimeout(f, 30000));
      await localBRE.run("verify:verify", {
        address: gmxPositionManagerDelegatorV2.address,
        constructorArguments: [],
      });
    }
  });
