import { task } from "hardhat/config";
import("@nomiclabs/hardhat-ethers");

task(`deploy-StargateManager`, `Deploys a StargateManager contract.`)
  .addParam("token", "The token to deposit and withdraw")
  .addParam("vault", "The vault that the position manager will interact with")
  .addParam("manager", "The manager Safe")
  .addParam("swaprouter", "The Uniswap V2-style swap router")
  .addParam("stargatelptoken", "The address of the S*{token}")
  .addParam("stargaterouter", "The address of the Stargate router")
  .addParam("stargaterouterpoolid", "The pool id for the S*{token} on the router")
  .addParam("stargatelpstaking", "The LP staking contract")
  .addParam("stargatelpstakingpoolid", "The LP staking pool id")
  .addParam("stgtoken", "The address of the STG contract")
  .addOptionalParam("verify", "Proceed with the Etherscan verification")
  .setAction(
    async (
      {
        token,
        vault,
        manager,
        swaprouter,
        stargatelptoken,
        stargaterouter,
        stargaterouterpoolid,
        stargatelpstaking,
        stargatelpstakingpoolid,
        stgtoken,
        verify,
      },
      localBRE
    ) => {
      // Deployer
      const signers = await localBRE.ethers.getSigners();
      const deployer = signers[0];

      console.log(`\n- Deployer: ${deployer.address}`);

      // GMXPositionManagerDelegator
      console.log(`\n- StargateManager deployment`);
      const args = [
        token,
        vault,
        manager,
        swaprouter,
        stargatelptoken,
        stargaterouter,
        stargaterouterpoolid,
        stargatelpstaking,
        stargatelpstakingpoolid,
        stgtoken,
      ];
      const stargateManagerImplementation = await localBRE.ethers.getContractFactory("StargateManager");

      const stargateManager = await localBRE.upgrades.deployProxy(stargateManagerImplementation, args);
      console.log(`\tDeployed StargateManager at address: ${stargateManager.address}\n`);

      if (verify) {
        console.log("Waiting for 30 seconds before verifying...");
        await new Promise(f => setTimeout(f, 30000));
        await localBRE.run("verify:verify", {
          address: stargateManager.address,
          constructorArguments: [],
        });
      }
    }
  );
