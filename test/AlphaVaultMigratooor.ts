import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { AlphaVaultProxy, AlphaVaultMigratooor, StargateManager, AlphaVaultMigratooorV2 } from "../typechain-types";
import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { unlockAddress } from "./helpers/unlockAddress";
import { generateDepositSignature } from "./helpers/generateDepositSignature";

const erc20Abi = require("./../abi/erc20.json");
const alphaVaultAbi = require("./../abi/alphaVault.json");

describe("AlphaVaultMigratooor", function () {
  let deployer: SignerWithAddress;
  let secondAct: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let manager: SignerWithAddress;

  let alphaVaultProd: Contract;
  let alphaVaultV1: AlphaVaultProxy;
  let stargateManagerV1: StargateManager;
  let alphaVaultV2: AlphaVaultProxy;
  let stargateManagerV2: StargateManager;
  let alphaVaultMigratooor: AlphaVaultMigratooor;
  let alphaVaultMigratooorProd: AlphaVaultMigratooor;
  let usdc: Contract;
  let usdcWhale: SignerWithAddress;

  let hedgeFarmManager: SignerWithAddress;
  let deployerDepositSignature: string;

  const usdcDecimals = 6;
  const depositAmount = ethers.utils.parseUnits("1000", "6");

  before(async function () {
    [deployer, secondAct, feeRecipient, manager] = await ethers.getSigners();

    const usdcAddress = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
    const cap = ethers.utils.parseUnits("10000", usdcDecimals);
    const traderJoeRouter = "0x60aE616a2155Ee3d9A68541Ba4544862310933d4";
    const stargateLpStakingAddress = "0x8731d54E9D02c286767d56ac03e8037C07e01e98";
    const stargateRouterAddress = "0x45A01E4e04F14f7A4a6702c74187c5F6222033cd";
    const stargateLpTokenAddress = "0x1205f31718499dBf1fCa446663B532Ef87481fe1";
    const stgTokenAddress = "0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590";
    const stargateRouterPoolId = "1";
    const stargateLpStakingPoolId = "0";

    // Connect to AlphaVault Prod
    hedgeFarmManager = await unlockAddress("0x39B5BEffbf118a720E9489344b28058F4d6310eA");
    deployerDepositSignature =
      "0xe9a4580a34b8f695a6aab69349f6e99d1e66e2aaec7eadf2c95c6bc57012907564fb2a8ff2841fc4b4f6026f82873c235c557f5ffa19948596045d03ac2adc481c";
    alphaVaultProd = await ethers.getContractAt(alphaVaultAbi, "0xdE4133f0CFA1a61Ba94EC64b6fEde4acC1fE929E");

    // Deploy AlphaVault V1
    const AlphaVault = await ethers.getContractFactory("AlphaVaultProxy");
    alphaVaultV1 = (await upgrades.deployProxy(
      AlphaVault,
      ["HedgeFarm Alpha 1 IOU", "hedgeAlpha1", usdcAddress, manager.address, feeRecipient.address, cap],
      {
        initializer: "initialize",
      }
    )) as AlphaVaultProxy;

    // Deploy StargateManager
    const StargateManager = await ethers.getContractFactory("StargateManager");
    stargateManagerV1 = (await upgrades.deployProxy(
      StargateManager,
      [
        usdcAddress,
        alphaVaultV1.address,
        manager.address,
        traderJoeRouter,
        stargateLpTokenAddress,
        stargateRouterAddress,
        stargateRouterPoolId,
        stargateLpStakingAddress,
        stargateLpStakingPoolId,
        stgTokenAddress,
      ],
      {
        initializer: "initialize",
      }
    )) as StargateManager;
    await stargateManagerV1.transferOwnership(manager.address);
    await alphaVaultV1.setYieldManager(stargateManagerV1.address);

    // Deploy AlphaVault V2
    alphaVaultV2 = (await upgrades.deployProxy(
      AlphaVault,
      ["HedgeFarm Alpha 1 IOU v2", "hedgeAlpha1v2", usdcAddress, manager.address, feeRecipient.address, cap],
      {
        initializer: "initialize",
      }
    )) as AlphaVaultProxy;

    // Deploy StargateManager
    stargateManagerV2 = (await upgrades.deployProxy(
      StargateManager,
      [
        usdcAddress,
        alphaVaultV2.address,
        manager.address,
        traderJoeRouter,
        stargateLpTokenAddress,
        stargateRouterAddress,
        stargateRouterPoolId,
        stargateLpStakingAddress,
        stargateLpStakingPoolId,
        stgTokenAddress,
      ],
      {
        initializer: "initialize",
      }
    )) as StargateManager;
    await stargateManagerV2.transferOwnership(manager.address);
    await alphaVaultV2.setYieldManager(stargateManagerV2.address);

    // Deploy AlphaVaultMigratooor
    const AlphaVaultMigratooor = await ethers.getContractFactory("AlphaVaultMigratooor");
    alphaVaultMigratooor = (await upgrades.deployProxy(AlphaVaultMigratooor, [usdcAddress, alphaVaultV1.address, alphaVaultV2.address], {
      initializer: "initialize",
    })) as AlphaVaultMigratooor;

    alphaVaultMigratooorProd = (await upgrades.deployProxy(AlphaVaultMigratooor, [usdcAddress, alphaVaultProd.address, alphaVaultV2.address], {
      initializer: "initialize",
    })) as AlphaVaultMigratooor;

    usdcWhale = await unlockAddress("0x9f8c163cBA728e99993ABe7495F06c0A3c8Ac8b9");
    usdc = await ethers.getContractAt(erc20Abi, usdcAddress, usdcWhale);

    // Fund deployer and second act with 100k USDC
    await usdc.connect(usdcWhale).transfer(deployer.address, depositAmount.mul(100));
    await usdc.connect(usdcWhale).transfer(secondAct.address, depositAmount.mul(100));
  });

  describe("Deployment", function () {
    it("Should deploy the contracts", async function () {
      expect(alphaVaultV1.address).not.to.equal("0x");
      expect(alphaVaultV2.address).not.to.equal("0x");
    });

    it("Should have the right name", async function () {
      const name = await alphaVaultV1.name();
      expect(name).to.equal("HedgeFarm Alpha 1 IOU");
      const nameV2 = await alphaVaultV2.name();
      expect(nameV2).to.equal("HedgeFarm Alpha 1 IOU v2");
      const nameProd = await alphaVaultProd.name();
      expect(nameProd).to.equal("HedgeFarm Alpha #1 USDC");
    });
  });

  describe("Proxy owner", function () {
    it("Should be the deployer the owner", async function () {
      const owner = await alphaVaultV1.owner();
      const ownerV2 = await alphaVaultV2.owner();
      const ownerProd = await alphaVaultProd.owner();
      const ownerMigratooor = await alphaVaultMigratooor.owner();
      const ownerMigratooorProd = await alphaVaultMigratooorProd.owner();

      expect(owner).to.be.eq(deployer.address);
      expect(ownerV2).to.be.eq(deployer.address);
      expect(ownerProd).to.be.eq("0x9b915390Aec8E18BE119c038F1e33E57a5ba53E5");
      expect(ownerMigratooor).to.be.eq(deployer.address);
      expect(ownerMigratooorProd).to.be.eq(deployer.address);
    });
  });

  describe("Migrate with V1 PPS = 1 and V2 PPS = 1", async function () {
    before(async () => {
      // Deposit in V1
      await usdc.connect(deployer).approve(alphaVaultV1.address, depositAmount);
      await alphaVaultV1.connect(deployer).deposit(depositAmount);
    });

    it("Should have some V1 IOU", async () => {
      const iouBalance = await alphaVaultV1.balanceOf(deployer.address);
      expect(iouBalance).to.be.eq(depositAmount);
    });

    it("Should be possible to migrate", async () => {
      const iouV1DeployerInitial = await alphaVaultV1.balanceOf(deployer.address);
      const iouV1MigratooorInitial = await alphaVaultV1.balanceOf(alphaVaultMigratooor.address);
      const iouV2DeployerInitial = await alphaVaultV2.balanceOf(deployer.address);
      const iouV2MigratooorInitial = await alphaVaultV2.balanceOf(alphaVaultMigratooor.address);
      const usdcDeployerBalanceInitial = await usdc.balanceOf(deployer.address);
      const usdcMigratooorBalanceInitial = await usdc.balanceOf(alphaVaultMigratooor.address);

      // Approve V1 IOU for spending on migrator
      await alphaVaultV1.connect(deployer).approve(alphaVaultMigratooor.address, iouV1DeployerInitial);

      // Migrate
      await alphaVaultMigratooor.connect(deployer).migrate();

      const iouV1DeployerFinal = await alphaVaultV1.balanceOf(deployer.address);
      const iouV1MigratooorFinal = await alphaVaultV1.balanceOf(alphaVaultMigratooor.address);
      const iouV2DeployerFinal = await alphaVaultV2.balanceOf(deployer.address);
      const iouV2MigratooorFinal = await alphaVaultV2.balanceOf(alphaVaultMigratooor.address);
      const usdcDeployerBalanceFinal = await usdc.balanceOf(deployer.address);
      const usdcMigratooorBalanceFinal = await usdc.balanceOf(alphaVaultMigratooor.address);

      // Deployer gets rid of his v1 IOUs
      expect(iouV1DeployerInitial).to.be.eq(depositAmount);
      expect(iouV1DeployerFinal).to.be.eq(0);

      // Migratooor should never hold permanently any v1 IOU
      expect(iouV1MigratooorInitial).to.be.eq(iouV1MigratooorFinal).to.be.eq(0);

      // Deployer gets new v2 IOUs
      expect(iouV2DeployerInitial).to.be.eq(0);
      expect(iouV2DeployerFinal).to.be.eq(depositAmount);

      // Migratooor should never hold permanently any v1 IOU
      expect(iouV2MigratooorInitial).to.be.eq(iouV2MigratooorFinal).to.be.eq(0);

      // Deployer USDC balance should not change in the end
      expect(usdcDeployerBalanceInitial).to.be.eq(usdcDeployerBalanceFinal);

      // Migrator USDC balance should not change in the end
      expect(usdcMigratooorBalanceInitial).to.be.eq(usdcMigratooorBalanceFinal).to.be.eq(0);
    });

    it("Should be possible for user to withdraw", async function () {
      const usdcDeployerBalanceInitial = await usdc.balanceOf(deployer.address);

      await alphaVaultV2.connect(deployer).withdrawAll();

      const iouV2DeployerFinal = await alphaVaultV2.balanceOf(deployer.address);
      const usdcDeployerBalanceFinal = await usdc.balanceOf(deployer.address);

      const delta = usdcDeployerBalanceFinal.sub(usdcDeployerBalanceInitial);
      expect(delta).to.be.closeTo(depositAmount, 1);
      expect(iouV2DeployerFinal).to.be.eq(0);
    });
  });

  describe("Migrate with V1 PPS = 1 and V2 PPS < 1", async function () {
    before(async () => {
      // Deposit in V1
      await usdc.connect(deployer).approve(alphaVaultV1.address, depositAmount);
      await alphaVaultV1.connect(deployer).deposit(depositAmount);

      // Lose money in V2
      await usdc.connect(secondAct).approve(alphaVaultV2.address, depositAmount);
      await alphaVaultV2.connect(secondAct).deposit(depositAmount);
      await alphaVaultV2.connect(manager).start();
      await alphaVaultV2.connect(manager).confirmTradesClosed();
      await alphaVaultV2.connect(manager).stop();
    });

    it("Should have a V2 PPS = 0.8", async function () {
      const pps = await alphaVaultV2.pricePerShare();
      expect(pps).to.be.closeTo(BigNumber.from(8).mul(BigNumber.from(10).pow(17)), BigNumber.from(10).pow(11)); // Stargate few wei
    });

    it("Should have some V1 IOU", async () => {
      const iouBalance = await alphaVaultV1.balanceOf(deployer.address);
      expect(iouBalance).to.be.eq(depositAmount);
    });

    it("Should be possible to migrate", async () => {
      const iouV1DeployerInitial = await alphaVaultV1.balanceOf(deployer.address);
      const iouV1MigratooorInitial = await alphaVaultV1.balanceOf(alphaVaultMigratooor.address);
      const iouV2DeployerInitial = await alphaVaultV2.balanceOf(deployer.address);
      const iouV2MigratooorInitial = await alphaVaultV2.balanceOf(alphaVaultMigratooor.address);
      const usdcDeployerBalanceInitial = await usdc.balanceOf(deployer.address);
      const usdcMigratooorBalanceInitial = await usdc.balanceOf(alphaVaultMigratooor.address);

      // Approve V1 IOU for spending on migrator
      await alphaVaultV1.connect(deployer).approve(alphaVaultMigratooor.address, iouV1DeployerInitial);

      // Migrate
      await alphaVaultMigratooor.connect(deployer).migrate();

      const iouV1DeployerFinal = await alphaVaultV1.balanceOf(deployer.address);
      const iouV1MigratooorFinal = await alphaVaultV1.balanceOf(alphaVaultMigratooor.address);
      const iouV2DeployerFinal = await alphaVaultV2.balanceOf(deployer.address);
      const iouV2MigratooorFinal = await alphaVaultV2.balanceOf(alphaVaultMigratooor.address);
      const usdcDeployerBalanceFinal = await usdc.balanceOf(deployer.address);
      const usdcMigratooorBalanceFinal = await usdc.balanceOf(alphaVaultMigratooor.address);

      // Deployer gets rid of his v1 IOUs
      expect(iouV1DeployerInitial).to.be.eq(depositAmount);
      expect(iouV1DeployerFinal).to.be.eq(0);

      // Migratooor should never hold permanently any v1 IOU
      expect(iouV1MigratooorInitial).to.be.eq(iouV1MigratooorFinal).to.be.eq(0);

      // Deployer gets new v2 IOUs
      expect(iouV2DeployerInitial).to.be.eq(0);
      expect(iouV2DeployerFinal).to.be.closeTo(BigNumber.from(1250).mul(BigNumber.from(10).pow(6)), 10); // 1000 USDC / 0.8 = 1250

      // Migratooor should never hold permanently any v1 IOU
      expect(iouV2MigratooorInitial).to.be.eq(iouV2MigratooorFinal).to.be.eq(0);

      // Deployer USDC balance should not change in the end
      expect(usdcDeployerBalanceInitial).to.be.eq(usdcDeployerBalanceFinal);

      // Migrator USDC balance should not change in the end
      expect(usdcMigratooorBalanceInitial).to.be.eq(usdcMigratooorBalanceFinal).to.be.eq(0);
    });

    it("Should be possible for user to withdraw", async function () {
      const usdcDeployerBalanceInitial = await usdc.balanceOf(deployer.address);

      await alphaVaultV2.connect(deployer).withdrawAll();

      const iouV2DeployerFinal = await alphaVaultV2.balanceOf(deployer.address);
      const usdcDeployerBalanceFinal = await usdc.balanceOf(deployer.address);

      const delta = usdcDeployerBalanceFinal.sub(usdcDeployerBalanceInitial);
      expect(delta).to.be.closeTo(depositAmount, 1);
      expect(iouV2DeployerFinal).to.be.eq(0);
    });

    after(async () => {
      await alphaVaultV2.connect(secondAct).withdrawAll();
    });
  });

  describe("Migrate with V1 PPS = 1 and V2 PPS > 1", async function () {
    before(async () => {
      // Deposit in V1
      await usdc.connect(deployer).approve(alphaVaultV1.address, depositAmount);
      await alphaVaultV1.connect(deployer).deposit(depositAmount);

      // Earn money in V2
      await usdc.connect(secondAct).approve(alphaVaultV2.address, depositAmount);
      await alphaVaultV2.connect(secondAct).deposit(depositAmount);
      await usdc.connect(secondAct).transfer(alphaVaultV2.address, depositAmount.mul(20).div(100));
    });

    it("Should have a V2 PPS = 1.2", async function () {
      const pps = await alphaVaultV2.pricePerShare();
      expect(pps).to.be.closeTo(BigNumber.from(12).mul(BigNumber.from(10).pow(17)), BigNumber.from(10).pow(11)); // Stargate few wei
    });

    it("Should have some V1 IOU", async () => {
      const iouBalance = await alphaVaultV1.balanceOf(deployer.address);
      expect(iouBalance).to.be.eq(depositAmount);
    });

    it("Should be possible to migrate", async () => {
      const iouV1DeployerInitial = await alphaVaultV1.balanceOf(deployer.address);
      const iouV1MigratooorInitial = await alphaVaultV1.balanceOf(alphaVaultMigratooor.address);
      const iouV2DeployerInitial = await alphaVaultV2.balanceOf(deployer.address);
      const iouV2MigratooorInitial = await alphaVaultV2.balanceOf(alphaVaultMigratooor.address);
      const usdcDeployerBalanceInitial = await usdc.balanceOf(deployer.address);
      const usdcMigratooorBalanceInitial = await usdc.balanceOf(alphaVaultMigratooor.address);

      // Approve V1 IOU for spending on migrator
      await alphaVaultV1.connect(deployer).approve(alphaVaultMigratooor.address, iouV1DeployerInitial);

      // Migrate
      await alphaVaultMigratooor.connect(deployer).migrate();

      const iouV1DeployerFinal = await alphaVaultV1.balanceOf(deployer.address);
      const iouV1MigratooorFinal = await alphaVaultV1.balanceOf(alphaVaultMigratooor.address);
      const iouV2DeployerFinal = await alphaVaultV2.balanceOf(deployer.address);
      const iouV2MigratooorFinal = await alphaVaultV2.balanceOf(alphaVaultMigratooor.address);
      const usdcDeployerBalanceFinal = await usdc.balanceOf(deployer.address);
      const usdcMigratooorBalanceFinal = await usdc.balanceOf(alphaVaultMigratooor.address);

      // Deployer gets rid of his v1 IOUs
      expect(iouV1DeployerInitial).to.be.eq(depositAmount);
      expect(iouV1DeployerFinal).to.be.eq(0);

      // Migratooor should never hold permanently any v1 IOU
      expect(iouV1MigratooorInitial).to.be.eq(iouV1MigratooorFinal).to.be.eq(0);

      // Deployer gets new v2 IOUs
      expect(iouV2DeployerInitial).to.be.eq(0);
      expect(iouV2DeployerFinal).to.be.closeTo(BigNumber.from(833).mul(BigNumber.from(10).pow(6)), BigNumber.from(10).pow(6)); // 1000 USDC / 1.2 = 833.34

      // Migratooor should never hold permanently any v1 IOU
      expect(iouV2MigratooorInitial).to.be.eq(iouV2MigratooorFinal).to.be.eq(0);

      // Deployer USDC balance should not change in the end
      expect(usdcDeployerBalanceInitial).to.be.eq(usdcDeployerBalanceFinal);

      // Migrator USDC balance should not change in the end
      expect(usdcMigratooorBalanceInitial).to.be.eq(usdcMigratooorBalanceFinal).to.be.eq(0);
    });

    it("Should be possible for user to withdraw", async function () {
      const usdcDeployerBalanceInitial = await usdc.balanceOf(deployer.address);

      await alphaVaultV2.connect(deployer).withdrawAll();

      const iouV2DeployerFinal = await alphaVaultV2.balanceOf(deployer.address);
      const usdcDeployerBalanceFinal = await usdc.balanceOf(deployer.address);

      const delta = usdcDeployerBalanceFinal.sub(usdcDeployerBalanceInitial);
      expect(delta).to.be.closeTo(depositAmount, 1);
      expect(iouV2DeployerFinal).to.be.eq(0);
    });
  });

  describe("Prod update", () => {
    before(async () => {
      // Update the state of the contract if needed
      const isEpochRunning = await alphaVaultProd.isEpochRunning();
      if (isEpochRunning) {
        await alphaVaultProd.connect(hedgeFarmManager).confirmTradesClosed();
        await alphaVaultProd.connect(hedgeFarmManager).stop(0);
      }

      // Deposit in Prod
      await usdc.connect(deployer).approve(alphaVaultProd.address, depositAmount);
      await alphaVaultProd.connect(deployer).deposit(depositAmount, deployerDepositSignature);
    });

    it("Should have some V1 IOU", async () => {
      const iouBalance = await alphaVaultProd.balanceOf(deployer.address);
      const currentPps = await alphaVaultProd.pricePerShare();
      const estimatedIouBalance = depositAmount.mul(BigNumber.from(10).pow(18)).div(currentPps);
      expect(iouBalance).to.be.eq(estimatedIouBalance);
    });

    it("Should be possible to migrate", async () => {
      const currentPps = await alphaVaultProd.pricePerShare();
      const iouV1DeployerInitialEstimated = depositAmount.mul(BigNumber.from(10).pow(18)).div(currentPps);

      const iouV1DeployerInitial = await alphaVaultProd.balanceOf(deployer.address);
      const iouV1MigratooorInitial = await alphaVaultProd.balanceOf(alphaVaultMigratooor.address);
      const iouV2DeployerInitial = await alphaVaultV2.balanceOf(deployer.address);
      const iouV2MigratooorInitial = await alphaVaultV2.balanceOf(alphaVaultMigratooor.address);
      const usdcDeployerBalanceInitial = await usdc.balanceOf(deployer.address);
      const usdcMigratooorBalanceInitial = await usdc.balanceOf(alphaVaultMigratooor.address);

      // Approve V1 IOU for spending on migrator
      await alphaVaultProd.connect(deployer).approve(alphaVaultMigratooorProd.address, iouV1DeployerInitial);

      // Migrate
      await alphaVaultMigratooorProd.connect(deployer).migrate();

      const iouV1DeployerFinal = await alphaVaultProd.balanceOf(deployer.address);
      const iouV1MigratooorFinal = await alphaVaultProd.balanceOf(alphaVaultMigratooor.address);
      const iouV2DeployerFinal = await alphaVaultV2.balanceOf(deployer.address);
      const iouV2MigratooorFinal = await alphaVaultV2.balanceOf(alphaVaultMigratooor.address);
      const usdcDeployerBalanceFinal = await usdc.balanceOf(deployer.address);
      const usdcMigratooorBalanceFinal = await usdc.balanceOf(alphaVaultMigratooor.address);

      // Deployer gets rid of his v1 IOUs
      expect(iouV1DeployerInitial).to.be.eq(iouV1DeployerInitialEstimated);
      expect(iouV1DeployerFinal).to.be.eq(0);

      // Migratooor should never hold permanently any v1 IOU
      expect(iouV1MigratooorInitial).to.be.eq(iouV1MigratooorFinal).to.be.eq(0);

      // Deployer gets new v2 IOUs
      const alphaVaultV2Pps = await alphaVaultV2.pricePerShare();
      const iouV2DeployerFinalEstimated = depositAmount.mul(BigNumber.from(10).pow(18)).div(alphaVaultV2Pps);
      expect(iouV2DeployerInitial).to.be.eq(0);
      expect(iouV2DeployerFinal).to.be.closeTo(iouV2DeployerFinalEstimated, 1);

      // Migratooor should never hold permanently any v1 IOU
      expect(iouV2MigratooorInitial).to.be.eq(iouV2MigratooorFinal).to.be.eq(0);

      // Deployer USDC balance should not change in the end
      expect(usdcDeployerBalanceInitial).to.be.eq(usdcDeployerBalanceFinal);

      // Migrator USDC balance should not change in the end
      expect(usdcMigratooorBalanceInitial).to.be.eq(usdcMigratooorBalanceFinal).to.be.eq(0);
    });

    it("Should be possible for user to withdraw", async function () {
      const usdcDeployerBalanceInitial = await usdc.balanceOf(deployer.address);

      await alphaVaultV2.connect(deployer).withdrawAll();

      const iouV2DeployerFinal = await alphaVaultV2.balanceOf(deployer.address);
      const usdcDeployerBalanceFinal = await usdc.balanceOf(deployer.address);

      const delta = usdcDeployerBalanceFinal.sub(usdcDeployerBalanceInitial);
      expect(delta).to.be.closeTo(depositAmount, 2);
      expect(iouV2DeployerFinal).to.be.eq(0);
    });
  });

  describe("Upgrade", async function () {
    let newAlphaVaultMigratoooor: AlphaVaultMigratooorV2;

    it("Should not be possible to upgrade the implementation if not owner", async function () {
      const AlphaVaultMigratooor = await ethers.getContractFactory("AlphaVaultMigratooorV2", secondAct);
      const tx = upgrades.upgradeProxy(alphaVaultMigratooor.address, AlphaVaultMigratooor);
      await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should be able to upgrade the implementation", async function () {
      const previousImplementation = await alphaVaultMigratooor.getImplementation();
      const previousToken = await alphaVaultMigratooor.token();

      const AlphaVaultMigratooor = await ethers.getContractFactory("AlphaVaultMigratooorV2", deployer);
      newAlphaVaultMigratoooor = (await upgrades.upgradeProxy(alphaVaultMigratooor.address, AlphaVaultMigratooor)) as AlphaVaultMigratooorV2;

      const newImplementation = await alphaVaultMigratooor.getImplementation();
      const newToken = await alphaVaultMigratooor.token();

      expect(alphaVaultMigratooor.address).to.be.eq(newAlphaVaultMigratoooor.address);
      expect(newImplementation).not.to.be.eq(previousImplementation);
      expect(newToken).to.be.eq(previousToken);
    });

    it("Should have a new value", async function () {
      const newVariable = await newAlphaVaultMigratoooor.answer();
      expect(newVariable).to.be.eq(42);
    });
  });

  describe("Upgrade Prod Migratooor", async function () {
    let newAlphaVaultMigratoooorProd: AlphaVaultMigratooorV2;

    it("Should not be possible to upgrade the implementation if not owner", async function () {
      const AlphaVaultMigratooor = await ethers.getContractFactory("AlphaVaultMigratooorV2", secondAct);
      const tx = upgrades.upgradeProxy(alphaVaultMigratooorProd.address, AlphaVaultMigratooor);
      await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should be able to upgrade the implementation", async function () {
      const previousImplementation = await alphaVaultMigratooorProd.getImplementation();
      const previousToken = await alphaVaultMigratooorProd.token();

      const AlphaVaultMigratooor = await ethers.getContractFactory("AlphaVaultMigratooorV2", deployer);
      newAlphaVaultMigratoooorProd = (await upgrades.upgradeProxy(alphaVaultMigratooorProd.address, AlphaVaultMigratooor)) as AlphaVaultMigratooorV2;

      const newImplementation = await alphaVaultMigratooorProd.getImplementation();
      const newToken = await alphaVaultMigratooorProd.token();

      expect(alphaVaultMigratooorProd.address).to.be.eq(newAlphaVaultMigratoooorProd.address);
      expect(newImplementation).not.to.be.eq(previousImplementation);
      expect(newToken).to.be.eq(previousToken);
    });

    it("Should have a new value", async function () {
      const newVariable = await newAlphaVaultMigratoooorProd.answer();
      expect(newVariable).to.be.eq(42);
    });
  });
});
