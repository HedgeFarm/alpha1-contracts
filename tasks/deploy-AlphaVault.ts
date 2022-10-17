import { task } from "hardhat/config";

import("@nomiclabs/hardhat-ethers");

task(`deploy-AlphaVault`, `Deploys an AlphaVault contract.`)
  .addParam("name", "The name of the IOU")
  .addParam("symbol", "The symbol of the IOU")
  .addParam("token", "The token to deposit and withdraw")
  .addParam("signer", "The signer for the deposits' signatures")
  .addParam("manager", "The safe in charge of start/stop/managing positions")
  .addParam("feerecipient", "The recipient of the performance and management fee")
  .addParam("cap", "Maximum cap * 1e18 decimals")
  .addParam("stargatelpstaking", "")
  .addParam("stargatelptoken", "")
  .addParam("stargaterouterpoolid", "")
  .addParam("stargatelpstakingpoolid", "")
  .addParam("ecdsa", "The address of the ECDSA library")
  .addOptionalParam("verify", "Proceed with the Etherscan verification")
  .setAction(
    async (
      {
        name,
        symbol,
        token,
        signer,
        manager,
        feerecipient,
        cap,
        stargatelpstaking,
        stargatelptoken,
        stargaterouterpoolid,
        stargatelpstakingpoolid,
        ecdsa,
        verify,
      },
      localBRE
    ) => {
      // Deployer
      const signers = await localBRE.ethers.getSigners();
      const deployer = signers[0];

      console.log(`\n- Deployer: ${deployer.address}`);

      // Native Vault
      console.log(`\n- AlphaVault deployment`);
      const args = [
        name,
        symbol,
        token,
        signer,
        manager,
        feerecipient,
        cap,
        stargatelpstaking,
        stargatelptoken,
        stargaterouterpoolid,
        stargatelpstakingpoolid,
      ];
      const AlphaVault = await localBRE.ethers.getContractFactory("AlphaVault", { libraries: { ECDSA: ecdsa } });

      const alphavault = await AlphaVault.deploy(
        name,
        symbol,
        token,
        signer,
        manager,
        feerecipient,
        cap,
        stargatelpstaking,
        stargatelptoken,
        stargaterouterpoolid,
        stargatelpstakingpoolid
      );
      console.log(`\tDeployed AlphaVault at address: ${alphavault.address}\n`);

      if (verify) {
        console.log("Waiting for 30 seconds before verifying...");
        await new Promise(f => setTimeout(f, 30000));
        await localBRE.run("verify:verify", {
          address: alphavault.address,
          constructorArguments: args,
        });
      }
    }
  );
