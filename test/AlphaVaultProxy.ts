import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  AlphaVaultProxy,
  AlphaVaultProxyV2,
  StargateManager,
} from "../typechain-types";
import { unlockAddress } from "./helpers/unlockAddress";
import { BigNumber, Contract, Signer, Wallet } from "ethers";
import { Sign } from "crypto";
import { mineExtraBlocks } from "./helpers/mineExtraBlocks";
import { toUtf8Bytes } from "ethers/lib/utils";
import { token } from "../typechain-types/@openzeppelin/contracts";
import { address } from "hardhat/internal/core/config/config-validation";

const erc20Abi = require("./../abi/erc20.json");
const stargateLpStakingAbi = require("./../abi/stargateLpStaking.json");
const gmxVaultAbi = require("./../abi/gmxVault.json");
const depositAmount = ethers.utils.parseUnits("1000", "6");
const halfDepositAmount = depositAmount.div(2);
const millionDepositAmount = ethers.utils.parseUnits("20000000", "6");

describe("AlphaVaultProxy", function () {
  let deployer: SignerWithAddress;
  let secondAct: SignerWithAddress;
  let thirdAct: SignerWithAddress;
  let tradingEoa: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let manager: SignerWithAddress;

  let alphaVault: AlphaVaultProxy;
  let stargateManager: StargateManager;
  let ecdsa: Contract;

  let usdc: Contract;
  let usdcWhale: SignerWithAddress;
  let usdcDecimals = 6;

  let usdt: Contract;
  let usdtWhale: SignerWithAddress;
  let usdtDecimals = 6;

  const stargateLpStakingPoolId = 0;
  let stargateLpStaking: Contract;

  let gmxVault: Contract;

  // Epoch 0
  let finalEpoch0TotalBalance: BigNumber;
  let finalEpoch0PricePerShare: BigNumber;

  before(async function () {
    [deployer, secondAct, thirdAct, feeRecipient, manager] = await ethers.getSigners();
    tradingEoa = await unlockAddress("0xe0a2f6EBF3E316cd38EEdd40ccd37Ac0A91280c4");

    const usdcAddress = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
    const usdtAddress = "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7";
    const cap = ethers.utils.parseUnits("10000", usdcDecimals);
    const traderJoeRouter = "0x60aE616a2155Ee3d9A68541Ba4544862310933d4";
    const stargateLpStakingAddress = "0x8731d54E9D02c286767d56ac03e8037C07e01e98";
    const stargateRouterAddress = "0x45A01E4e04F14f7A4a6702c74187c5F6222033cd";
    const stargateLpTokenAddress = "0x1205f31718499dBf1fCa446663B532Ef87481fe1";
    const stgTokenAddress = "0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590";
    const stargateRouterPoolId = "1";
    const stargateLpStakingPoolId = "0";

    // Deploy AlphaVault
    const AlphaVault = await ethers.getContractFactory("AlphaVaultProxy");
    alphaVault = (await upgrades.deployProxy(
      AlphaVault,
      ["HedgeFarm Alpha 1 IOU", "hedgeAlpha1", usdcAddress, manager.address, feeRecipient.address, cap],
      {
        initializer: "initialize",
      }
    )) as AlphaVaultProxy;

    // Deploy StargateManager
    const StargateManager = await ethers.getContractFactory("StargateManager");
    stargateManager = (await upgrades.deployProxy(
      StargateManager,
      [
        usdcAddress,
        alphaVault.address,
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
    await stargateManager.transferOwnership(manager.address);

    usdcWhale = await unlockAddress("0x9f8c163cBA728e99993ABe7495F06c0A3c8Ac8b9");
    usdc = await ethers.getContractAt(erc20Abi, usdcAddress, usdcWhale);

    usdtWhale = await unlockAddress("0x9f8c163cBA728e99993ABe7495F06c0A3c8Ac8b9");
    usdt = await ethers.getContractAt(erc20Abi, usdtAddress, usdtWhale);

    stargateLpStaking = await ethers.getContractAt(stargateLpStakingAbi, stargateLpStakingAddress, usdcWhale);
    gmxVault = await ethers.getContractAt(gmxVaultAbi, "0x9ab2De34A33fB459b538c43f251eB825645e8595", usdcWhale);
  });

  describe("Deployment", function () {
    it("Should deploy the contracts", async function () {
      expect(alphaVault.address).not.to.equal("0x");
    });

    it("Should have the right name", async function () {
      const name = await alphaVault.name();
      expect(name).to.equal("HedgeFarm Alpha 1 IOU");
    });
  });

  describe("Proxy owner", function () {
    it("Should be the deployer the owner", async function () {
      const owner = await alphaVault.owner();
      expect(owner).to.be.eq(deployer.address);
    });
  });

  describe("Pre-epoch", function () {
    before(async function () {
      // Fund deployer with USDC
      await usdc.connect(usdcWhale).transfer(deployer.address, depositAmount.mul(10));
      await usdc.connect(usdcWhale).transfer(secondAct.address, depositAmount.mul(10));
      await usdc.connect(usdcWhale).transfer(thirdAct.address, depositAmount.mul(10));
      // Fund trading wallet with AVAX
      await deployer.sendTransaction({
        to: tradingEoa.address,
        value: ethers.utils.parseEther("1"),
      });
      // Set fees
      await alphaVault.setFees(2, 20);
    });

    it("Should have received 10k USDC", async function () {
      expect(await usdc.balanceOf(deployer.address)).to.be.eq(depositAmount.mul(10));
      expect(await usdc.balanceOf(secondAct.address)).to.be.eq(depositAmount.mul(10));
      expect(await usdc.balanceOf(thirdAct.address)).to.be.eq(depositAmount.mul(10));
    });

    it("Should not be possible to deposit less than 10 USDC for the first deposit", async function () {
      const smallDepositAmount = ethers.utils.parseUnits("5", usdcDecimals);
      await usdc.connect(deployer).approve(alphaVault.address, smallDepositAmount);
      const tx = alphaVault.deposit(smallDepositAmount);
      await expect(tx).to.be.revertedWith("Min amount not met");
    });

    it("Should be able to deposit pre-epoch", async function () {
      const deployerInitialBalance = await usdc.balanceOf(deployer.address);
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);

      await usdc.connect(deployer).approve(alphaVault.address, depositAmount);
      await alphaVault.deposit(depositAmount);

      const deployerFinalBalance = await usdc.balanceOf(deployer.address);
      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const deployerShares = await alphaVault.balanceOf(deployer.address);

      expect(deployerFinalBalance).to.be.lt(deployerInitialBalance);
      expect(vaultFinalBalance).to.be.gt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.eq(depositAmount);
      expect(deployerShares).to.be.eq(depositAmount);
    });

    it("Should not be possible to deposit more than cap", async function () {
      const tx = alphaVault.deposit(depositAmount.mul(10));
      await expect(tx).to.be.revertedWith("Cap reached");
    });

    it("Should be possible to withdraw 50%", async function () {
      const deployerInitialBalance = await usdc.balanceOf(deployer.address);
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const deployerInitialShares = await alphaVault.balanceOf(deployer.address);

      await alphaVault.withdraw(deployerInitialShares.div(2));

      const deployerFinalBalance = await usdc.balanceOf(deployer.address);
      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const deployerFinalShares = await alphaVault.balanceOf(deployer.address);

      // We withdrew 50%, so we only have 5k left
      expect(deployerFinalBalance).to.be.gt(deployerInitialBalance);
      expect(vaultFinalBalance).to.be.lt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.eq(halfDepositAmount);
      expect(deployerFinalShares).to.be.lt(deployerInitialShares);
      expect(deployerFinalShares).to.be.eq(halfDepositAmount);
    });

    it("Should have correct IOU for a second deposit", async function () {
      const secondActInitialBalance = await usdc.balanceOf(secondAct.address);
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);

      await usdc.connect(secondAct).approve(alphaVault.address, depositAmount);
      await alphaVault.connect(secondAct).deposit(depositAmount);

      const secondActFinalBalance = await usdc.balanceOf(secondAct.address);
      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const secondActShares = await alphaVault.balanceOf(secondAct.address);

      // We add 1k on top of the remaining 0.5k
      expect(secondActFinalBalance).to.be.lt(secondActInitialBalance);
      expect(vaultFinalBalance).to.be.gt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.eq(halfDepositAmount.add(depositAmount));
      expect(secondActShares).to.be.eq(depositAmount);
    });

    it("Should not be able to withdraw zero shares", async function () {
      const tx = alphaVault.connect(secondAct).withdraw(0);
      await expect(tx).to.be.revertedWith("Withdraw is 0");
    });

    it("Should have a correct total balance", async function () {
      // Deployer: 0.5k + SecondAct: 1k = 1.5k
      expect(await alphaVault.totalBalance()).to.be.eq(halfDepositAmount.add(depositAmount));
    });

    it("Should have a correct price per share", async function () {
      expect(await alphaVault.pricePerShare()).to.be.eq(ethers.utils.parseEther("1"));
    });
  });

  describe("Start Epoch 0", function () {
    it("Should not be possible to start if no Yield Manager is set", async () => {
      const tx = alphaVault.start();
      await expect(tx).to.be.revertedWith("No yield manager");
    });

    it("Should be possible to set a Yield Manager", async () => {
      const tx = alphaVault.setYieldManager(stargateManager.address);
      await expect(tx).not.to.be.reverted;
    });

    it("Should deposit in Stargate", async function () {
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const managerInitialBalance = await usdc.balanceOf(manager.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);

      await alphaVault.start();

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const managerFinalBalance = await usdc.balanceOf(manager.address);
      const expectedManagerFinalBalance = vaultInitialBalance.mul(20).div(100);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);

      expect(vaultFinalBalance).to.be.lt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.eq(0);
      expect(managerInitialBalance).to.be.eq(0);
      expect(managerFinalBalance).to.be.eq(expectedManagerFinalBalance);
      expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0]);
    });

    it("Should not be possible to start an epoch when it's running", async () => {
      const tx = alphaVault.start();
      await expect(tx).to.be.revertedWith("Already started");
    });

    it("Should have a cached total balance", async function () {
      // Deployer: 0.5k + SecondAct: 1k = 1.5k
      // Cached when we `start`
      expect(await alphaVault.totalBalance()).to.be.eq(halfDepositAmount.add(depositAmount));
    });

    it("Should have a cached price per share", async function () {
      // Cached when we start
      expect(await alphaVault.pricePerShare()).to.be.eq(ethers.utils.parseEther("1"));
    });

    it("Should not be possible to deposit", async function () {
      const tx = alphaVault.deposit(depositAmount);
      await expect(tx).to.be.revertedWith("Disabled when during epoch");
    });

    it("Should not be possible to withdraw", async function () {
      const tx = alphaVault.withdraw(1);
      await expect(tx).to.be.revertedWith("Disabled when during epoch");
    });
  });

  describe("Stop Epoch 0", async function () {
    before(async function () {
      await mineExtraBlocks(100);

      // Fund the missing funds from closing the long and the short
      const balance = await usdc.balanceOf(manager.address);
      await usdc.connect(manager).transfer(alphaVault.address, balance);
    });

    it("Should be possible to harvest and autocompound", async function () {
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);

      await alphaVault.harvest(true);

      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);

      expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0]);
    });

    it("Should not be possible to stop before confirming all trades are closed and executed", async () => {
      const tx = alphaVault.stop();
      await expect(tx).to.be.revertedWith("Confirm trading stopped first");
    });

    it("Should be possible to confirm trading funds arrived", async () => {
      const isTradingStart = await alphaVault.isTrading();

      await alphaVault.confirmTradesClosed();

      const isTradingStop = await alphaVault.isTrading();
      expect(isTradingStart).to.be.eq(true);
      expect(isTradingStop).to.be.eq(false);
    });

    it("Should not be possible to stop and redeem instant with a value", async function () {
      const tx = alphaVault.stop({ value: ethers.utils.parseEther("0.1") });
      await expect(tx).to.be.revertedWith("Redeem requires no funds");
    });

    it("Should be able to stop epoch and compute fees", async function () {
      const isEpochStart = await alphaVault.isEpochRunning();
      const iouSupplyStart = await alphaVault.totalSupply();
      const stratUsdcStart = await alphaVault.totalBalance();
      const performanceFeeStart = await usdc.balanceOf(feeRecipient.address);

      await alphaVault.stop();

      const isEpochEnd = await alphaVault.isEpochRunning();
      const iouSupplyEnd = await alphaVault.totalSupply();
      const iouSupplyDelta = iouSupplyEnd.sub(iouSupplyStart);
      const stratUsdcEnd = await alphaVault.totalBalance();
      const deltaStratUsdc = stratUsdcEnd.sub(stratUsdcStart);
      const performanceFeeEnd = await usdc.balanceOf(feeRecipient.address);
      const performanceFeeDelta = performanceFeeEnd.sub(performanceFeeStart);

      expect(isEpochStart).to.be.eq(true);
      expect(isEpochEnd).to.be.eq(false);
      expect(iouSupplyEnd).to.be.gt(iouSupplyStart);
      expect(performanceFeeEnd).to.be.gt(performanceFeeStart);
      expect(performanceFeeDelta.mul(100).div(performanceFeeDelta.add(deltaStratUsdc))).to.be.closeTo(20, 1); // 20% performance fee
    });

    it("Should not be able to stop epoch if it's already stopped", async () => {
      const tx = alphaVault.stop();
      await expect(tx).to.be.revertedWith("Already stopped");
    });

    it("Should have an updated total balance", async function () {
      // Deployer: 0.5k + SecondAct: 1k = 1.5k
      // We had some rewards
      finalEpoch0TotalBalance = await alphaVault.totalBalance();
      expect(finalEpoch0TotalBalance).to.be.gt(halfDepositAmount.add(depositAmount));
    });

    it("Should have an updated price per share", async function () {
      // Cached when we start
      finalEpoch0PricePerShare = await alphaVault.pricePerShare();
      expect(finalEpoch0PricePerShare).to.be.gt(ethers.utils.parseEther("1"));
    });

    it("Should not be possible to withdraw more shares than owned", async function () {
      const totalShares = await alphaVault.totalSupply();

      const tx = alphaVault.withdraw(totalShares);
      await expect(tx).to.be.revertedWith("Not enough shares");
    });

    it("Should be possible to withdraw funds", async function () {
      const deployerInitialBalance = await usdc.balanceOf(deployer.address);
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const deployerInitialShares = await alphaVault.balanceOf(deployer.address);

      await alphaVault.withdraw(deployerInitialShares);

      const deployerFinalBalance = await usdc.balanceOf(deployer.address);
      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const deployerFinalShares = await alphaVault.balanceOf(deployer.address);

      const deployerDelta = deployerFinalBalance.sub(deployerInitialBalance);

      // We withdrew the rest of the deployer shares, only secondAct's 1k left
      expect(deployerFinalBalance).to.be.gt(deployerInitialBalance);
      expect(deployerDelta).to.be.gt(ethers.utils.parseUnits("500", "6"));
      expect(vaultFinalBalance).to.be.lt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.gt(depositAmount);
      expect(deployerFinalShares).to.be.lt(deployerInitialShares);
      expect(deployerFinalShares).to.be.eq(0);
    });

    it("Should be possible to deposit funds", async function () {
      const deployerInitialBalance = await usdc.balanceOf(deployer.address);
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);

      await usdc.connect(deployer).approve(alphaVault.address, depositAmount);
      await alphaVault.deposit(depositAmount);

      const deployerFinalBalance = await usdc.balanceOf(deployer.address);
      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const deployerShares = await alphaVault.balanceOf(deployer.address);

      // We now have two deposits of 1k = 2k
      // Shares are worth > 1, so less shares than amount
      expect(deployerFinalBalance).to.be.lt(deployerInitialBalance);
      expect(vaultFinalBalance).to.be.gt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.gt(depositAmount.mul(2));
      expect(deployerShares).to.be.lt(depositAmount);
    });
  });

  describe("Start Epoch 1", function () {
    before(async () => {
      // Remove fees
      await alphaVault.setFees(0, 0);
    });

    it("Should deposit in Stargate and send funds to trading wallet", async function () {
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const managerInitialBalance = await usdc.balanceOf(manager.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);

      await alphaVault.start();

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const managerFinalBalance = await usdc.balanceOf(manager.address);
      const expectedManagerFinalBalance = vaultInitialBalance.mul(20).div(100);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);

      expect(vaultFinalBalance).to.be.eq(0);
      expect(managerInitialBalance).to.be.eq(0);
      expect(managerFinalBalance).to.be.closeTo(expectedManagerFinalBalance, 1);
      expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0]);
    });

    it("Should have a cached total balance", async function () {
      // Deployer: 0.5k + SecondAct: 1k = 1.5k
      // Cached when we `start`
      expect(await alphaVault.totalBalance()).to.be.gt(depositAmount.mul(2));
    });

    it("Should have a cached price per share", async function () {
      // Cached when we start
      expect(await alphaVault.pricePerShare()).to.be.gt(ethers.utils.parseEther("1"));
    });

    it("Should not be possible to deposit", async function () {
      const tx = alphaVault.deposit(depositAmount);
      await expect(tx).to.be.revertedWith("Disabled when during epoch");
    });

    it("Should not be possible to withdraw", async function () {
      const tx = alphaVault.withdraw(1);
      await expect(tx).to.be.revertedWith("Disabled when during epoch");
    });
  });

  describe("Stop Epoch 1", async function () {
    before(async function () {
      await mineExtraBlocks(100);

      // Fund the missing funds from closing the long and the short
      const balance = await usdc.balanceOf(manager.address);
      await usdc.connect(manager).transfer(alphaVault.address, balance);
    });

    it("Should be possible to harvest and autocompound", async function () {
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);

      await alphaVault.harvest(true);

      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);

      expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0]);
    });

    it("Should be able to stop epoch and compute fees", async function () {
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);
      const iouSupplyStart = await alphaVault.totalSupply();
      const stratUsdcStart = await alphaVault.totalBalance();
      const performanceFeeStart = await usdc.balanceOf(feeRecipient.address);

      await alphaVault.confirmTradesClosed();
      await alphaVault.stop();

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);
      const iouSupplyEnd = await alphaVault.totalSupply();
      const stratUsdcEnd = await alphaVault.totalBalance();
      const deltaStratUsdc = stratUsdcEnd.sub(stratUsdcStart);
      const performanceFeeEnd = await usdc.balanceOf(feeRecipient.address);

      expect(vaultFinalBalance).to.be.gt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.gt(depositAmount.add(halfDepositAmount));
      expect(lpStakingFinalBalance[0]).to.be.lt(lpStakingInitialBalance[0]);
      expect(lpStakingFinalBalance[0]).to.be.eq(0);
      expect(iouSupplyEnd).to.be.eq(iouSupplyStart);
      expect(performanceFeeEnd).to.be.eq(performanceFeeStart);
    });

    it("Should have an updated total balance", async function () {
      // Deployer: 0.5k + SecondAct: 1k = 1.5k
      // We had some rewards
      expect(await alphaVault.totalBalance()).to.be.gt(finalEpoch0TotalBalance);
    });

    it("Should have an updated price per share", async function () {
      // Cached when we start
      expect(await alphaVault.pricePerShare()).to.be.gt(finalEpoch0PricePerShare);
    });

    it("Should be possible to withdraw funds", async function () {
      const deployerInitialBalance = await usdc.balanceOf(deployer.address);
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const deployerInitialShares = await alphaVault.balanceOf(deployer.address);

      await alphaVault.withdrawAll();

      const deployerFinalBalance = await usdc.balanceOf(deployer.address);
      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const deployerFinalShares = await alphaVault.balanceOf(deployer.address);

      const deployerDelta = deployerFinalBalance.sub(deployerInitialBalance);

      // We withdrew all the deployer shares (1k+), only secondAct's 1k left
      expect(deployerFinalBalance).to.be.gt(deployerInitialBalance);
      expect(deployerDelta).to.be.gt(ethers.utils.parseUnits("1000", "6"));
      expect(vaultFinalBalance).to.be.lt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.gt(depositAmount);
      expect(deployerFinalShares).to.be.lt(deployerInitialShares);
      expect(deployerFinalShares).to.be.eq(0);
    });

    it("Should be possible to deposit funds", async function () {
      const deployerInitialBalance = await usdc.balanceOf(deployer.address);
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);

      await usdc.connect(deployer).approve(alphaVault.address, depositAmount);
      await alphaVault.deposit(depositAmount);

      const deployerFinalBalance = await usdc.balanceOf(deployer.address);
      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const deployerShares = await alphaVault.balanceOf(deployer.address);

      // We now have two deposits of 1k = 2k
      // Shares are worth > 1, so less shares than amount
      expect(deployerFinalBalance).to.be.lt(deployerInitialBalance);
      expect(vaultFinalBalance).to.be.gt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.gt(depositAmount.mul(2));
      expect(deployerShares).to.be.lt(depositAmount);
    });

    it("Should not be possible to deposit more than cap", async function () {
      const tx = alphaVault.deposit(depositAmount.mul(10));
      await expect(tx).to.be.revertedWith("Cap reached");
    });
  });

  describe("Start Epoch 2", function () {
    before(async () => {
      // Withdraw all
      const deployerShares = await alphaVault.balanceOf(deployer.address);
      await alphaVault.withdraw(deployerShares);
      const secondActShares = await alphaVault.balanceOf(secondAct.address);
      await alphaVault.connect(secondAct).withdraw(secondActShares);

      // Set Cap to 20.01M (with IOU dilution we need a bit margin)
      await alphaVault.setCap(ethers.utils.parseUnits("20010000", "6"));

      // Fund deployer with more USDC
      await usdc.connect(usdcWhale).transfer(deployer.address, millionDepositAmount);

      // Deposit a big amount (20M) to test Stargate async withdraw
      // Done in chunks of 50k for deposit limit
      await usdc.connect(deployer).approve(alphaVault.address, millionDepositAmount);
      await alphaVault.connect(deployer).deposit(millionDepositAmount);
    });

    it("Should deposit in Stargate and send funds to trading wallet", async function () {
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const managerInitialBalance = await usdc.balanceOf(manager.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);

      await alphaVault.start();

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const managerFinalBalance = await usdc.balanceOf(manager.address);
      const expectedManagerFinalBalance = vaultInitialBalance.mul(20).div(100);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);

      expect(vaultFinalBalance).to.be.lt(vaultInitialBalance);
      expect(managerInitialBalance).to.be.eq(0);
      expect(managerFinalBalance).to.be.closeTo(expectedManagerFinalBalance, 1);
      expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0]);
    });
  });

  describe("Stop Epoch 2 - Funds lost", async function () {
    it("Should be able to confirm all trades are closed", async () => {
      const tx = alphaVault.confirmTradesClosed();
      await expect(tx).not.to.be.reverted;
    });

    it("Should not be able to stop epoch with wrong message value", async function () {
      const tx = alphaVault.stop({ value: ethers.utils.parseEther("0.1") });
      await expect(tx).to.be.revertedWith("RedeemLocal requires funds");
    });

    it("Should be able to stop epoch", async function () {
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const lendingManagerInitialBalance = await usdc.balanceOf(stargateManager.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);

      await alphaVault.connect(deployer).stop({ value: ethers.utils.parseEther("1") });

      // Simulate transfer from LayerZero
      await usdc.connect(usdcWhale).transfer(stargateManager.address, millionDepositAmount.mul(80).div(100));
      await stargateManager.connect(manager).withdrawToken();
      await alphaVault.confirmAsyncRedeem();

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const lendingManagerFinalBalance = await usdc.balanceOf(stargateManager.address);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, stargateManager.address);

      expect(vaultFinalBalance).to.be.gt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.lt(millionDepositAmount);
      expect(lendingManagerInitialBalance).to.be.eq(lendingManagerFinalBalance).to.be.eq(0);
      expect(lpStakingFinalBalance[0]).to.be.lt(lpStakingInitialBalance[0]);
      expect(lpStakingFinalBalance[0]).to.be.eq(0);
    });

    it("Should have an updated total balance", async function () {
      // Deployer: 20M
      // Lost 20% of capital
      expect(await alphaVault.totalBalance()).to.be.lt(millionDepositAmount);
    });

    it("Should have an updated price per share", async function () {
      // Lost 20% of capital
      expect(await alphaVault.pricePerShare()).to.be.lt(ethers.utils.parseEther("1"));
    });

    it("Should be possible to withdraw funds", async function () {
      const deployerInitialBalance = await usdc.balanceOf(deployer.address);
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const deployerInitialShares = await alphaVault.balanceOf(deployer.address);

      await alphaVault.withdraw(deployerInitialShares.div(2));

      const deployerFinalBalance = await usdc.balanceOf(deployer.address);
      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const deployerFinalShares = await alphaVault.balanceOf(deployer.address);

      const deployerDelta = deployerFinalBalance.sub(deployerInitialBalance);

      expect(deployerFinalBalance).to.be.gt(deployerInitialBalance);
      expect(deployerDelta).to.be.lt(millionDepositAmount.div(2));
      expect(vaultFinalBalance).to.be.lt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.lt(millionDepositAmount.div(2));
      expect(deployerFinalShares).to.be.closeTo(deployerInitialShares.div(2), 1);
    });

    it("Should be possible to deposit funds", async function () {
      const deployerInitialBalance = await usdc.balanceOf(deployer.address);
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);

      await usdc.connect(deployer).approve(alphaVault.address, depositAmount);
      await alphaVault.deposit(depositAmount);

      const deployerFinalBalance = await usdc.balanceOf(deployer.address);
      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const deployerShares = await alphaVault.balanceOf(deployer.address);

      // Shares are worth < 1, so more shares than amount
      expect(deployerFinalBalance).to.be.lt(deployerInitialBalance);
      expect(vaultFinalBalance).to.be.gt(vaultInitialBalance);
      expect(deployerShares).to.be.gt(depositAmount);
    });
  });

  describe("Administrative methods", function () {
    describe("Cap", function () {
      before(async function () {
        await usdc.connect(thirdAct).approve(alphaVault.address, depositAmount.mul(10));
      });

      it("Should not be able to change cap if not owner", async function () {
        const tx = alphaVault.connect(thirdAct).setCap(millionDepositAmount.mul(10));
        await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Should be able to change cap if owner", async function () {
        // Set cap to current balance + 10k
        const totalBalance = await alphaVault.totalBalance();

        const expectedNewCap = totalBalance.add(depositAmount.mul(10));
        const tx = alphaVault.connect(deployer).setCap(expectedNewCap);

        await expect(tx).not.to.be.reverted;

        const newCap = await alphaVault.cap();
        expect(expectedNewCap).to.be.eq(newCap);
      });

      it("Should be able to deposit with new cap", async function () {
        // Deposit
        const tx = alphaVault.connect(thirdAct).deposit(depositAmount.mul(10));
        await expect(tx).not.to.be.reverted;
      });

      it("Should not be able to deposit more than cap", async function () {
        const tx = alphaVault.connect(deployer).deposit(depositAmount);
        await expect(tx).to.be.revertedWith("Cap reached");
      });
    });

    describe("Start / Stop", async function () {
      it("Should not be possible to start if not owner", async function () {
        const tx = alphaVault.connect(thirdAct).start();
        await expect(tx).to.be.revertedWith("Unauthorized");
      });

      it("Should not be possible to stop if not owner", async function () {
        const tx = alphaVault.connect(thirdAct).stop();
        await expect(tx).to.be.revertedWith("Unauthorized");
      });
    });

    describe("Harvest", async function () {
      it("Should not be possible to call harvest when epoch is not running", async function () {
        const tx = alphaVault.harvest(false);
        await expect(tx).to.be.revertedWith("No funds in lending");
      });

      it("Should not be possible to call harvest if not owner", async () => {
        const tx = alphaVault.connect(thirdAct).harvest(false);
        await expect(tx).to.be.revertedWith("Unauthorized");
      });
    });

    describe("Fees", async function () {
      it("Should not be possible to call set fees if not owner", async function () {
        const tx = alphaVault.connect(thirdAct).setFees(0, 0);
        await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Should be possible to call set fees if owner", async function () {
        const tx = await alphaVault.setFees(2, 20);
        const managementFee = await alphaVault.managementFee();
        const performanceFee = await alphaVault.performanceFee();
        expect(managementFee).to.be.eq(2);
        expect(performanceFee).to.be.eq(20);
      });

      it("Should not be possible to call set fees if management fee is too high", async function () {
        const tx = alphaVault.setFees(10, 0);
        await expect(tx).to.be.reverted;
      });

      it("Should not be possible to call set fees if performance fee is too high", async function () {
        const tx = alphaVault.setFees(2, 50);
        await expect(tx).to.be.reverted;
      });
    });

    describe("Manager", async function () {
      it("Should not be possible to change manager if not owner", async function () {
        const tx = alphaVault.connect(thirdAct).setManager(thirdAct.address);
        await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Should be possible to change manager if owner", async function () {
        const tx = await alphaVault.connect(deployer).setManager(thirdAct.address);
        const newManager = await alphaVault.manager();
        expect(newManager).to.be.eq(thirdAct.address);
      });

      after(async function () {
        await alphaVault.connect(deployer).setManager(manager.address);
      });
    });

    describe("Fee recipient", async function () {
      it("Should not be possible to change fee recipient if not owner", async function () {
        const tx = alphaVault.connect(thirdAct).setFeeRecipient(thirdAct.address);
        await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Should be possible to change fee recipient if owner", async function () {
        const tx = await alphaVault.connect(deployer).setFeeRecipient(thirdAct.address);
        const newFeeRecipient = await alphaVault.feeRecipient();
        expect(newFeeRecipient).to.be.eq(thirdAct.address);
      });
    });

    describe("Lending manager", async function () {
      it("Should not be possible to change lending manager if not owner", async function () {
        const tx = alphaVault.connect(thirdAct).setYieldManager(thirdAct.address);
        await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Should be possible to change yield manager if owner", async function () {
        const tx = await alphaVault.connect(deployer).setYieldManager(thirdAct.address);
        const newFeeRecipient = await alphaVault.yieldManager();
        expect(newFeeRecipient).to.be.eq(thirdAct.address);
      });
    });

    describe("Funds stuck", function () {
      const usdcAmount = ethers.utils.parseUnits("100", usdcDecimals);
      const usdtAmount = ethers.utils.parseUnits("100", usdtDecimals);

      before(async () => {
        await usdc.connect(usdcWhale).transfer(alphaVault.address, usdcAmount);
        await usdt.connect(usdtWhale).transfer(alphaVault.address, usdtAmount);
      });

      it("Should not be possible to rescue USDC", async () => {
        const tx = alphaVault.connect(manager).rescue(usdc.address);
        await expect(tx).to.be.revertedWith("No rug");
      });

      it("Should be possible to rescue USDT", async () => {
        const managerInitialBalance = await usdt.balanceOf(manager.address);
        const vaultInitialBalance = await usdt.balanceOf(alphaVault.address);

        await alphaVault.connect(manager).rescue(usdt.address);

        const managerFinalBalance = await usdt.balanceOf(manager.address);
        const vaultFinalBalance = await usdt.balanceOf(alphaVault.address);
        const vaultDelta = vaultInitialBalance.sub(vaultFinalBalance);

        expect(managerInitialBalance).to.be.eq(0);
        expect(managerFinalBalance).to.be.eq(usdtAmount);
        expect(vaultDelta).to.be.eq(usdtAmount);
      });
    });

    describe("Upgrade", async function () {
      let newAlphaVault: AlphaVaultProxyV2;

      it("Should not be possible to upgrade the implementation if not owner", async function () {
        const AlphaVault = await ethers.getContractFactory("AlphaVaultProxyV2", secondAct);
        const tx = upgrades.upgradeProxy(alphaVault.address, AlphaVault);
        await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Should be able to upgrade the implementation", async function () {
        const previousImplementation = await alphaVault.getImplementation();
        const previousToken = await alphaVault.token();

        const AlphaVault = await ethers.getContractFactory("AlphaVaultProxyV2");
        newAlphaVault = (await upgrades.upgradeProxy(alphaVault.address, AlphaVault, {})) as AlphaVaultProxyV2;

        const newImplementation = await alphaVault.getImplementation();
        const newToken = await alphaVault.token();

        expect(alphaVault.address).to.be.eq(newAlphaVault.address);
        expect(newImplementation).not.to.be.eq(previousImplementation);
        expect(newToken).to.be.eq(previousToken);
      });

      it("Should have a new value", async function () {
        const newVariable = await newAlphaVault.answer();
        expect(newVariable).to.be.eq(42);
      });
    });
  });
});
