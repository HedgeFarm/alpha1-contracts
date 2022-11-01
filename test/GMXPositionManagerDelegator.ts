import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { AlphaVault, GMXPositionManager, GMXPositionManagerDelegator, GMXPositionManagerDelegatorV2 } from "../typechain-types";
import { BigNumber, Contract } from "ethers";
import { ethers, upgrades } from "hardhat";
import { unlockAddress } from "./helpers/unlockAddress";
import { generateDepositSignature } from "./helpers/generateDepositSignature";
import { expect } from "chai";

const erc20Abi = require("./../abi/erc20.json");

describe("GMXPositionManagerDelegator", function () {
  let usdc: Contract;
  const usdcAddress = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
  const usdcDecimals = 6;

  let deployer: SignerWithAddress;
  let secondAct: SignerWithAddress;
  let mockAlphaVault: SignerWithAddress;
  let manager: SignerWithAddress;
  let usdcWhale: SignerWithAddress;

  let gmxPositionManager: GMXPositionManagerDelegator;

  before(async function () {
    [deployer, secondAct, mockAlphaVault] = await ethers.getSigners();
    manager = await unlockAddress("0x39B5BEffbf118a720E9489344b28058F4d6310eA");

    await deployer.sendTransaction({
      to: manager.address,
      value: ethers.utils.parseEther("1"),
    });

    // Deploy GMXPositionManager
    const GMXPositionManager = await ethers.getContractFactory("GMXPositionManagerDelegator");
    gmxPositionManager = (await upgrades.deployProxy(GMXPositionManager, [usdcAddress, mockAlphaVault.address, manager.address], {
      initializer: "initialize",
    })) as GMXPositionManagerDelegator;

    usdc = await ethers.getContractAt(erc20Abi, usdcAddress, usdcWhale);
    usdcWhale = await unlockAddress("0x279f8940ca2a44C35ca3eDf7d28945254d0F0aE6");
  });

  describe("Proxy owner", function () {
    it("Should be the deployer the owner", async function () {
      const owner = await gmxPositionManager.owner();
      expect(owner).to.be.eq(deployer.address);
    });

    it("Should be possible to change the owner", async function () {
      const previousOwner = await gmxPositionManager.owner();
      await gmxPositionManager.transferOwnership(manager.address);
      const newOwner = await gmxPositionManager.owner();

      expect(previousOwner).to.be.eq(deployer.address);
      expect(newOwner).to.be.eq(manager.address);
    });
  });

  describe("Withdraw funds", function () {
    const withdrawAmount = ethers.utils.parseUnits("10000", usdcDecimals);
    const halfWithdrawAmount = withdrawAmount.div(2);

    before(async () => {
      await usdc.connect(usdcWhale).transfer(gmxPositionManager.address, withdrawAmount);
    });

    it("Shouldn't be able to withdraw funds if not owner", async function () {
      const tx = gmxPositionManager.connect(secondAct).withdrawFunds(usdcAddress, withdrawAmount);
      await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should be able to withdraw part of the funds if owner", async function () {
      const pmUsdcInitialBalance = await usdc.balanceOf(gmxPositionManager.address);
      const vaultUsdcInitialBalance = await usdc.balanceOf(manager.address);

      await gmxPositionManager.connect(manager).withdrawFunds(usdcAddress, halfWithdrawAmount);

      const pmUsdcFinalBalance = await usdc.balanceOf(gmxPositionManager.address);
      const vaultUsdcFinalBalance = await usdc.balanceOf(manager.address);

      expect(pmUsdcInitialBalance).to.be.eq(withdrawAmount);
      expect(vaultUsdcInitialBalance).to.be.eq(0);
      expect(pmUsdcFinalBalance).to.be.eq(halfWithdrawAmount);
      expect(vaultUsdcFinalBalance).to.be.eq(halfWithdrawAmount);
    });

    it("Should be able to withdraw the rest of the funds", async function () {
      const pmUsdcInitialBalance = await usdc.balanceOf(gmxPositionManager.address);
      const vaultUsdcInitialBalance = await usdc.balanceOf(manager.address);

      const usdcBalanceToWithdraw = pmUsdcInitialBalance;

      await gmxPositionManager.connect(manager).withdrawFunds(usdcAddress, usdcBalanceToWithdraw);

      const pmUsdcFinalBalance = await usdc.balanceOf(gmxPositionManager.address);
      const vaultUsdcFinalBalance = await usdc.balanceOf(manager.address);

      expect(pmUsdcInitialBalance).to.be.eq(halfWithdrawAmount);
      expect(vaultUsdcInitialBalance).to.be.eq(halfWithdrawAmount);
      expect(pmUsdcFinalBalance).to.be.eq(0);
      expect(vaultUsdcFinalBalance).to.be.eq(withdrawAmount);
    });
  });

  describe("Withdraw native", function () {
    const nativeBalance = ethers.utils.parseEther("1");

    before(async () => {
      await deployer.sendTransaction({
        to: gmxPositionManager.address,
        value: nativeBalance,
      });
    });

    it("Should have a balance of 1 AVAX", async () => {
      const balance = await ethers.provider.getBalance(gmxPositionManager.address);
      expect(balance).to.be.eq(nativeBalance);
    });

    it("Should be able to transfer the balance to manager", async () => {
      const managerBalance = await ethers.provider.getBalance(manager.address);
      const positionManagerBalance = await ethers.provider.getBalance(gmxPositionManager.address);

      await gmxPositionManager.connect(manager).withdrawNative();

      const endManagerBalance = await ethers.provider.getBalance(manager.address);
      const managerDelta = endManagerBalance.sub(managerBalance);
      const endPositionManagerBalance = await ethers.provider.getBalance(gmxPositionManager.address);

      expect(endManagerBalance).to.be.gt(managerBalance);
      expect(managerDelta).to.be.gt(ethers.utils.parseUnits("0.99")); // Manager calling the function so account for gas fees
      expect(endPositionManagerBalance).to.be.lt(positionManagerBalance);
      expect(endPositionManagerBalance).to.be.eq(0);
    });
  });

  describe("Set vault", function () {
    it("Shouldn't be able to set new vault if not owner", async function () {
      const tx = gmxPositionManager.connect(secondAct).setVault(secondAct.address);
      await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Shouldn't be able to set new vault to address zero", async function () {
      const tx = gmxPositionManager.connect(manager).setVault("0x0000000000000000000000000000000000000000");
      await expect(tx).to.be.revertedWith("Address == 0");
    });

    it("Should be able to set new vault if owner", async function () {
      const previousVault = await gmxPositionManager.vault();

      await gmxPositionManager.connect(manager).setVault(secondAct.address);

      const newVault = await gmxPositionManager.vault();
      expect(previousVault).to.be.eq(mockAlphaVault.address);
      expect(newVault).to.be.eq(secondAct.address);
    });
  });

  describe("Set token", function () {
    const usdce = "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664";

    it("Shouldn't be able to set new token if not owner", async function () {
      const tx = gmxPositionManager.connect(secondAct).setToken(usdce);
      await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Shouldn't be able to set new token to address zero", async function () {
      const tx = gmxPositionManager.connect(manager).setToken("0x0000000000000000000000000000000000000000");
      await expect(tx).to.be.revertedWith("Address == 0");
    });

    it("Should be able to set new token if owner", async function () {
      const previousToken = await gmxPositionManager.token();

      await gmxPositionManager.connect(manager).setToken(usdce);

      const newToken = await gmxPositionManager.token();
      expect(previousToken).to.be.eq(usdc.address);
      expect(newToken).to.be.eq(usdce);
    });
  });

  describe("Set manager", function () {
    const updatedManager = "0x9b915390Aec8E18BE119c038F1e33E57a5ba53E5";

    it("Shouldn't be able to set new manager if not owner", async function () {
      const tx = gmxPositionManager.connect(secondAct).setManager(updatedManager);
      await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Shouldn't be able to set new manager to address zero", async function () {
      const tx = gmxPositionManager.connect(manager).setManager("0x0000000000000000000000000000000000000000");
      await expect(tx).to.be.revertedWith("Address == 0");
    });

    it("Should be able to set new manager if owner", async function () {
      const previousManager = await gmxPositionManager.manager();

      await gmxPositionManager.connect(manager).setManager(updatedManager);

      const newManager = await gmxPositionManager.manager();
      expect(previousManager).to.be.eq(manager.address);
      expect(newManager).to.be.eq(updatedManager);
    });
  });

  describe("Upgrade", async function () {
    let newGmxPositionManager: GMXPositionManagerDelegatorV2;
    it("Should be able to upgrade the implementation", async function () {
      const previousImplementation = await gmxPositionManager.getImplementation();
      const previousToken = await gmxPositionManager.token();

      const GMXPositionManager = await ethers.getContractFactory("GMXPositionManagerDelegatorV2", manager);
      newGmxPositionManager = (await upgrades.upgradeProxy(gmxPositionManager.address, GMXPositionManager, {
        call: "initializeV2",
      })) as GMXPositionManagerDelegatorV2;

      const newImplementation = await gmxPositionManager.getImplementation();
      const newToken = await gmxPositionManager.token();

      expect(gmxPositionManager.address).to.be.eq(newGmxPositionManager.address);
      expect(newImplementation).not.to.be.eq(previousImplementation);
      expect(newToken).not.to.be.eq(previousToken);
    });

    it("Should have a new value", async function () {
      const newVariable = await newGmxPositionManager.answer();
      expect(newVariable).to.be.eq(42);
    });
  });
});
