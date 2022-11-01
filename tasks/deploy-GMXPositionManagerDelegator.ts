import { task } from "hardhat/config";
import("@nomiclabs/hardhat-ethers");

task(`deploy-GMXPositionManagerDelegator`, `Deploys a GMXPositionManager contract.`)
  .addParam("token", "The token to deposit and withdraw")
  .addParam("vault", "The vault that the position manager will interact with")
  .addParam("manager", "The multi-sig that will manage the funds")
  .addOptionalParam("verify", "Proceed with the Etherscan verification")
  .setAction(async ({ token, vault, manager, verify }, localBRE) => {
    // Deployer
    const signers = await localBRE.ethers.getSigners();
    const deployer = signers[0];

    console.log(`\n- Deployer: ${deployer.address}`);

    // GMXPositionManagerDelegator
    console.log(`\n- GMXPositionManager deployment`);
    const args = [token, vault, manager];
    const gmxPositionManagerDelegatorImplementation = await localBRE.ethers.getContractFactory("GMXPositionManagerDelegator");

    const gmxPositionManagerDelegator = await localBRE.upgrades.deployProxy(gmxPositionManagerDelegatorImplementation, args);
    console.log(`\tDeployed GMXPositionManagerDelegator at address: ${gmxPositionManagerDelegator.address}\n`);

    if (verify) {
      console.log("Waiting for 30 seconds before verifying...");
      await new Promise(f => setTimeout(f, 30000));
      await localBRE.run("verify:verify", {
        address: gmxPositionManagerDelegator.address,
        constructorArguments: [],
      });

      const implementation = await gmxPositionManagerDelegator.getImplementation();
      await localBRE.run("verify:verify", {
        address: implementation,
        constructorArguments: [],
      });
    }
  });
