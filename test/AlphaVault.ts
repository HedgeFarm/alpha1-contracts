import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { AlphaVault, GMXPositionManager, GMXPositionManagerDelegator, GMXPositionManagerDelegatorV2 } from "../typechain-types";
import { unlockAddress } from "./helpers/unlockAddress";
import { BigNumber, Contract, Signer, Wallet } from "ethers";
import { Sign } from "crypto";
import { mineExtraBlocks } from "./helpers/mineExtraBlocks";
import { generateDepositSignature } from "./helpers/generateDepositSignature";
import { toUtf8Bytes } from "ethers/lib/utils";
import { token } from "../typechain-types/@openzeppelin/contracts";
import { address } from "hardhat/internal/core/config/config-validation";

const erc20Abi = require("./../abi/erc20.json");
const stargateLpStakingAbi = require("./../abi/stargateLpStaking.json");
const gmxVaultAbi = require("./../abi/gmxVault.json");
const depositAmount = ethers.utils.parseUnits("1000", "6");
const halfDepositAmount = depositAmount.div(2);
const millionDepositAmount = ethers.utils.parseUnits("5000000", "6");

describe("AlphaVault", function () {
  let deployer: SignerWithAddress;
  let secondAct: SignerWithAddress;
  let thirdAct: SignerWithAddress;
  let tradingEoa: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let manager: SignerWithAddress;

  // For the deposit signature generation
  let hedgeFarmSigner: SignerWithAddress;
  let deployerDepositSignature: string;
  let secondActDepositSignature: string;
  let thirdActDepositSignature: string;

  let alphaVault: AlphaVault;
  let gmxPositionManager: GMXPositionManagerDelegator;
  let usdc: Contract;
  let usdcWhale: SignerWithAddress;
  let usdcDecimals = 6;

  const stargateLpStakingPoolId = 0;
  let stargateLpStaking: Contract;

  let gmxVault: Contract;

  // Epoch 0
  let finalEpoch0TotalBalance: BigNumber;
  let finalEpoch0PricePerShare: BigNumber;

  before(async function () {
    [deployer, secondAct, thirdAct, hedgeFarmSigner, feeRecipient, manager] = await ethers.getSigners();
    tradingEoa = await unlockAddress("0xe0a2f6EBF3E316cd38EEdd40ccd37Ac0A91280c4");

    deployerDepositSignature = await generateDepositSignature(hedgeFarmSigner, deployer);
    secondActDepositSignature = await generateDepositSignature(hedgeFarmSigner, secondAct);
    thirdActDepositSignature = await generateDepositSignature(hedgeFarmSigner, thirdAct);

    const usdcAddress = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
    const cap = ethers.utils.parseUnits("10000", usdcDecimals);
    const pancakeSwapRouter = "0x60aE616a2155Ee3d9A68541Ba4544862310933d4";
    const stargateLpStakingAddress = "0x8731d54E9D02c286767d56ac03e8037C07e01e98";
    const stargateRouterAddress = "0x45A01E4e04F14f7A4a6702c74187c5F6222033cd";
    const stargateLpTokenAddress = "0x1205f31718499dBf1fCa446663B532Ef87481fe1";
    const stgTokenAddress = "0x45A01E4e04F14f7A4a6702c74187c5F6222033cd";
    const stargateRouterPoolId = "1";

    // Deploy ECDSA
    const ECDSA = await ethers.getContractFactory("ECDSA");
    const ecdsa = await ECDSA.deploy();

    // Deploy AlphaVault
    const AlphaVault = await ethers.getContractFactory("AlphaVault", { libraries: { ECDSA: ecdsa.address } });
    alphaVault = await AlphaVault.deploy(
      "HedgeFarm Alpha 1 IOU",
      "hedgeAlpha1",
      usdcAddress,
      hedgeFarmSigner.address,
      manager.address,
      feeRecipient.address,
      cap,
      stargateLpStakingAddress,
      stargateLpTokenAddress,
      stargateRouterPoolId,
      stargateLpStakingPoolId
    );

    // Deploy GMXPositionManager
    const GMXPositionManagerDelegator = await ethers.getContractFactory("GMXPositionManagerDelegator");
    gmxPositionManager = (await upgrades.deployProxy(GMXPositionManagerDelegator, [
      usdcAddress,
      alphaVault.address,
      manager.address,
    ])) as GMXPositionManagerDelegator;
    await gmxPositionManager.transferOwnership(manager.address);

    usdcWhale = await unlockAddress("0x279f8940ca2a44C35ca3eDf7d28945254d0F0aE6");
    usdc = await ethers.getContractAt(erc20Abi, usdcAddress, usdcWhale);
    stargateLpStaking = await ethers.getContractAt(stargateLpStakingAbi, stargateLpStakingAddress, usdcWhale);
    gmxVault = await ethers.getContractAt(gmxVaultAbi, "0x9ab2De34A33fB459b538c43f251eB825645e8595", usdcWhale);
  });

  describe("Deployment", function () {
    it("Should deploy the contracts", async function () {
      expect(alphaVault.address).not.to.equal("0x");
      expect(gmxPositionManager.address).not.to.equal("0x");
    });

    it("Should have the right name", async function () {
      const name = await alphaVault.name();
      expect(name).to.equal("HedgeFarm Alpha 1 IOU");
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

    it("Should not be able to deposit less than 500 USD", async function () {
      const tx = alphaVault.deposit(ethers.utils.parseUnits("499", "6"), deployerDepositSignature);
      await expect(tx).to.be.revertedWith("Out of limits");
    });

    it("Should not be able to deposit more than 50k USD", async function () {
      const tx = alphaVault.deposit(ethers.utils.parseUnits("50001", "6"), deployerDepositSignature);
      await expect(tx).to.be.revertedWith("Out of limits");
    });

    it("Should be able to deposit pre-epoch", async function () {
      const deployerInitialBalance = await usdc.balanceOf(deployer.address);
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);

      await usdc.connect(deployer).approve(alphaVault.address, depositAmount);
      await alphaVault.deposit(depositAmount, deployerDepositSignature);

      const deployerFinalBalance = await usdc.balanceOf(deployer.address);
      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const deployerShares = await alphaVault.balanceOf(deployer.address);

      expect(deployerFinalBalance).to.be.lt(deployerInitialBalance);
      expect(vaultFinalBalance).to.be.gt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.eq(depositAmount);
      expect(deployerShares).to.be.eq(depositAmount);
    });

    it("Should not be able to deposit with a wrong signature", async function () {
      const fakeSignature = await generateDepositSignature(secondAct, deployer);
      const tx = alphaVault.deposit(depositAmount, fakeSignature);

      await expect(tx).to.be.revertedWith("Not allowed");
    });

    it("Should not be possible to deposit more than cap", async function () {
      const tx = alphaVault.deposit(depositAmount.mul(10), deployerDepositSignature);
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
      await alphaVault.connect(secondAct).deposit(depositAmount, secondActDepositSignature);

      const secondActFinalBalance = await usdc.balanceOf(secondAct.address);
      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const secondActShares = await alphaVault.balanceOf(secondAct.address);

      // We add 1k on top of the remaining 0.5k
      expect(secondActFinalBalance).to.be.lt(secondActInitialBalance);
      expect(vaultFinalBalance).to.be.gt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.eq(halfDepositAmount.add(depositAmount));
      expect(secondActShares).to.be.eq(depositAmount);
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
    it("Should not be possible to start if there's no manager", async function () {
      await alphaVault.setGMXPositionManager("0x0000000000000000000000000000000000000000");

      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const keepersFee = ethers.utils.parseEther("0.02");
      const tx = alphaVault.start();
      await expect(tx).to.be.revertedWith("No GMX manager");

      await alphaVault.setGMXPositionManager(gmxPositionManager.address);
    });

    it("Should not be possible to open a position if start wasn't triggered", async () => {
      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.openPosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", tokenAmount, true, { value: keepersFee });
      await expect(tx).to.be.revertedWith("Not trading period");
    });

    it("Should not be possible to close a position if start wasn't triggered", async () => {
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.closePosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", true, { value: keepersFee });
      await expect(tx).to.be.revertedWith("Not trading period");
    });

    it("Should deposit in Stargate", async function () {
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);

      await alphaVault.start();

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const expectedVaultFinalBalance = vaultInitialBalance.mul(20).div(100);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);

      expect(vaultFinalBalance).to.be.lt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.eq(expectedVaultFinalBalance);
      expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0]);
    });

    it("Should not be possible to start an epoch when it's running", async () => {
      const tx = alphaVault.start();
      await expect(tx).to.be.revertedWith("Already started");
    });

    it("Should not be possible to request the opening of a position with no position manager", async () => {
      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const keepersFee = ethers.utils.parseEther("0.01");

      await alphaVault.setGMXPositionManager("0x0000000000000000000000000000000000000000");

      const tx = alphaVault.openPosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", tokenAmount, true, { value: keepersFee });
      await expect(tx).to.be.revertedWith("No position manager");

      await alphaVault.setGMXPositionManager(gmxPositionManager.address);
    });

    it("Should not be possible to request the opening of a position with a wrong value", async function () {
      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const keepersFee = ethers.utils.parseEther("0.01");

      const tx = alphaVault.openPosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", tokenAmount, true, { value: keepersFee });
      await expect(tx).to.be.revertedWith("Wrong value");
    });

    it("Should not be possible to request the opening of a position with an amount too small", async function () {
      const tokenAmount = ethers.utils.parseUnits("5", "6");
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.openPosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", tokenAmount, true, { value: keepersFee });
      await expect(tx).to.be.revertedWith("Min amount not met");
    });

    it("Should not be possible to directly open a position on the manager", async () => {
      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const keepersFee = ethers.utils.parseEther("0.02");
      const tx = gmxPositionManager.openPosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", tokenAmount, true, { value: keepersFee });
      await expect(tx).to.be.revertedWith("Not vault");
    });

    it("Should be possible to request the opening of a AVAX/USD long position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const positionManagerBalance = await usdc.balanceOf(gmxPositionManager.address);
      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.openPosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", tokenAmount, true, { value: keepersFee });
      await expect(tx).not.to.be.reverted;

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const positionManagerFinalBalance = await usdc.balanceOf(gmxPositionManager.address);
      const vaultDelta = vaultBalance.sub(vaultFinalBalance);
      expect(vaultFinalBalance).to.be.lt(vaultBalance);
      expect(positionManagerFinalBalance).to.be.gt(positionManagerBalance);
      expect(vaultDelta).to.be.eq(tokenAmount);
    });

    it("Should be possible to request the opening of a AVAX/USD short position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const positionManagerBalance = await usdc.balanceOf(gmxPositionManager.address);
      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.openPosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", tokenAmount, false, { value: keepersFee });
      await expect(tx).not.to.be.reverted;

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const positionManagerFinalBalance = await usdc.balanceOf(gmxPositionManager.address);
      const vaultDelta = vaultBalance.sub(vaultFinalBalance);
      expect(vaultFinalBalance).to.be.lt(vaultBalance);
      expect(positionManagerFinalBalance).to.be.gt(positionManagerBalance);
      expect(vaultDelta).to.be.eq(tokenAmount);
    });

    it("Should be possible to request the opening of a ETH/USD long position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const positionManagerBalance = await usdc.balanceOf(gmxPositionManager.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.openPosition("0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", tokenAmount, true, { value: keepersFee });
      await expect(tx).not.to.be.reverted;

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const positionManagerFinalBalance = await usdc.balanceOf(gmxPositionManager.address);
      const vaultDelta = vaultBalance.sub(vaultFinalBalance);
      expect(vaultFinalBalance).to.be.lt(vaultBalance);
      expect(positionManagerFinalBalance).to.be.gt(positionManagerBalance);
      expect(vaultDelta).to.be.eq(tokenAmount);
    });

    it("Should be possible to request the opening of a ETH/USD short position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const positionManagerBalance = await usdc.balanceOf(gmxPositionManager.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.openPosition("0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", tokenAmount, false, { value: keepersFee });
      await expect(tx).not.to.be.reverted;

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const positionManagerFinalBalance = await usdc.balanceOf(gmxPositionManager.address);
      const vaultDelta = vaultBalance.sub(vaultFinalBalance);
      expect(vaultFinalBalance).to.be.lt(vaultBalance);
      expect(positionManagerFinalBalance).to.be.gt(positionManagerBalance);
      expect(vaultDelta).to.be.eq(tokenAmount);
    });

    it("Should be possible to request the opening of a WBTC/USD long position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const positionManagerBalance = await usdc.balanceOf(gmxPositionManager.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.openPosition("0x50b7545627a5162F82A992c33b87aDc75187B218", tokenAmount, true, { value: keepersFee });
      await expect(tx).not.to.be.reverted;

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const positionManagerFinalBalance = await usdc.balanceOf(gmxPositionManager.address);
      const vaultDelta = vaultBalance.sub(vaultFinalBalance);
      expect(vaultFinalBalance).to.be.lt(vaultBalance);
      expect(positionManagerFinalBalance).to.be.gt(positionManagerBalance);
      expect(vaultDelta).to.be.eq(tokenAmount);
    });

    it("Should be possible to request the opening of a WBTC/USD short position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const positionManagerBalance = await usdc.balanceOf(gmxPositionManager.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.openPosition("0x50b7545627a5162F82A992c33b87aDc75187B218", tokenAmount, false, { value: keepersFee });
      await expect(tx).not.to.be.reverted;

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const positionManagerFinalBalance = await usdc.balanceOf(gmxPositionManager.address);
      const vaultDelta = vaultBalance.sub(vaultFinalBalance);
      expect(vaultFinalBalance).to.be.lt(vaultBalance);
      expect(positionManagerFinalBalance).to.be.gt(positionManagerBalance);
      expect(vaultDelta).to.be.eq(tokenAmount);
    });

    it("Should be possible to request the opening of a BTC.B/USD long position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const positionManagerBalance = await usdc.balanceOf(gmxPositionManager.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.openPosition("0x152b9d0FdC40C096757F570A51E494bd4b943E50", tokenAmount, true, { value: keepersFee });
      await expect(tx).not.to.be.reverted;

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const positionManagerFinalBalance = await usdc.balanceOf(gmxPositionManager.address);
      const vaultDelta = vaultBalance.sub(vaultFinalBalance);
      expect(vaultFinalBalance).to.be.lt(vaultBalance);
      expect(positionManagerFinalBalance).to.be.gt(positionManagerBalance);
      expect(vaultDelta).to.be.eq(tokenAmount);
    });

    it("Should be possible to request the opening of a BTC.B/USD short position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const tokenAmount = ethers.utils.parseUnits("15", "6");
      const positionManagerBalance = await usdc.balanceOf(gmxPositionManager.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.openPosition("0x152b9d0FdC40C096757F570A51E494bd4b943E50", tokenAmount, false, { value: keepersFee });
      await expect(tx).not.to.be.reverted;

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const positionManagerFinalBalance = await usdc.balanceOf(gmxPositionManager.address);
      const vaultDelta = vaultBalance.sub(vaultFinalBalance);
      expect(vaultFinalBalance).to.be.lt(vaultBalance);
      expect(positionManagerFinalBalance).to.be.gt(positionManagerBalance);
      expect(vaultDelta).to.be.eq(tokenAmount);
    });

    it("Should not be possible to request the closing of a position with no position manager", async () => {
      const keepersFee = ethers.utils.parseEther("0.01");

      await alphaVault.setGMXPositionManager("0x0000000000000000000000000000000000000000");

      const tx = alphaVault.closePosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", true, { value: keepersFee });
      await expect(tx).to.be.revertedWith("No position manager");

      await alphaVault.setGMXPositionManager(gmxPositionManager.address);
    });

    it("Should not be possible to request the closing of a position with a wrong value", async function () {
      const keepersFee = ethers.utils.parseEther("0.01");

      const tx = alphaVault.closePosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", true, { value: keepersFee });
      await expect(tx).to.be.revertedWith("Wrong value");
    });

    it("Should be possible to request the closing of a AVAX/USD long position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.closePosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", true, { value: keepersFee });

      await expect(tx).not.to.be.reverted;
    });

    it("Should be possible to request the closing of a AVAX/USD short position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.closePosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", false, { value: keepersFee });

      await expect(tx).not.to.be.reverted;
    });

    it("Should be possible to request the closing of a ETH/USD long position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.closePosition("0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", true, { value: keepersFee });

      await expect(tx).not.to.be.reverted;
    });

    it("Should be possible to request the closing of a ETH/USD short position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.closePosition("0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", false, { value: keepersFee });

      await expect(tx).not.to.be.reverted;
    });

    it("Should be possible to request the closing of a WBTC/USD long position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.closePosition("0x50b7545627a5162F82A992c33b87aDc75187B218", true, { value: keepersFee });

      await expect(tx).not.to.be.reverted;
    });

    it("Should be possible to request the closing of a WBTC/USD short position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.closePosition("0x50b7545627a5162F82A992c33b87aDc75187B218", false, { value: keepersFee });

      await expect(tx).not.to.be.reverted;
    });

    it("Should be possible to request the closing of a BTC.B/USD long position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.closePosition("0x152b9d0FdC40C096757F570A51E494bd4b943E50", true, { value: keepersFee });

      await expect(tx).not.to.be.reverted;
    });

    it("Should be possible to request the closing of a BTC.B/USD short position on GMX", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.closePosition("0x152b9d0FdC40C096757F570A51E494bd4b943E50", false, { value: keepersFee });

      await expect(tx).not.to.be.reverted;
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
      const tx = alphaVault.deposit(depositAmount, deployerDepositSignature);
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
      await usdc.connect(usdcWhale).transfer(alphaVault.address, ethers.utils.parseUnits("120", "6"));
    });

    it("Should be possible to harvest and autocompound", async function () {
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);

      await alphaVault.harvest(true);

      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);

      expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0]);
    });

    it("Should not be possible to stop before confirming all trades are closed and executed", async () => {
      const tx = alphaVault.stop(110);
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
      const tx = alphaVault.stop(110, { value: ethers.utils.parseEther("0.1") });
      await expect(tx).to.be.revertedWith("Redeem requires no funds");
    });

    it("Should be able to stop epoch and compute fees", async function () {
      const isEpochStart = await alphaVault.isEpochRunning();
      const iouSupplyStart = await alphaVault.totalSupply();
      const stratUsdcStart = await alphaVault.totalBalance();
      const performanceFeeStart = await usdc.balanceOf(feeRecipient.address);

      await alphaVault.stop(110);

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
      const tx = alphaVault.stop(110);
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
      await alphaVault.deposit(depositAmount, deployerDepositSignature);

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
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);

      await alphaVault.start();

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const expectedVaultFinalBalance = vaultInitialBalance.mul(20).div(100);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);

      expect(vaultFinalBalance).to.be.lt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.closeTo(expectedVaultFinalBalance, 1);
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
      const tx = alphaVault.deposit(depositAmount, deployerDepositSignature);
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
    });

    it("Should be possible to harvest and autocompound", async function () {
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);

      await alphaVault.harvest(true);

      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);

      expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0]);
    });

    it("Should be able to stop epoch and compute fees", async function () {
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);
      const iouSupplyStart = await alphaVault.totalSupply();
      const stratUsdcStart = await alphaVault.totalBalance();
      const performanceFeeStart = await usdc.balanceOf(feeRecipient.address);

      await alphaVault.confirmTradesClosed();
      await alphaVault.stop(110);

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);
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
      await alphaVault.deposit(depositAmount, deployerDepositSignature);

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
      const tx = alphaVault.deposit(depositAmount.mul(10), deployerDepositSignature);
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

      // Set Cap to 5.01M (with IOU dilution we need a bit margin)
      await alphaVault.setCap(ethers.utils.parseUnits("5010000", "6"));

      // Fund deployer with more USDC
      await usdc.connect(usdcWhale).transfer(deployer.address, millionDepositAmount);

      // Deposit a big amount (5M) to test Stargate async withdraw
      // Done in chunks of 50k for deposit limit
      await usdc.connect(deployer).approve(alphaVault.address, millionDepositAmount);
      const loopCount = millionDepositAmount.div(ethers.utils.parseUnits("50000", "6"));
      for (let i = 0; i < loopCount.toNumber(); i++) {
        await alphaVault.connect(deployer).deposit(ethers.utils.parseUnits("50000", "6"), deployerDepositSignature);
      }
    });

    it("Should be able to upgrade GMXPositionManager", async () => {
      const previousImplementation = await gmxPositionManager.getImplementation();
      const previousToken = await gmxPositionManager.token();

      const test = await gmxPositionManager.owner();

      const GMXPositionManager = await ethers.getContractFactory("GMXPositionManagerDelegatorV2", manager);
      const newGmxPositionManager = (await upgrades.upgradeProxy(gmxPositionManager.address, GMXPositionManager, {
        call: "initializeV2",
      })) as GMXPositionManagerDelegatorV2;

      const newImplementation = await gmxPositionManager.getImplementation();
      const newToken = await gmxPositionManager.token();

      expect(gmxPositionManager.address).to.be.eq(newGmxPositionManager.address);
      expect(newImplementation).not.to.be.eq(previousImplementation);
      expect(newToken).not.to.be.eq(previousToken);

      // Post upgrade
      await gmxPositionManager.connect(manager).setToken(usdc.address);
    });

    it("Should deposit in Stargate and send funds to trading wallet", async function () {
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);

      await alphaVault.start();

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const expectedVaultFinalBalance = vaultInitialBalance.mul(20).div(100);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);

      expect(vaultFinalBalance).to.be.lt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.closeTo(expectedVaultFinalBalance, 1);
      expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0]);
    });
  });

  describe("Stop Epoch 2 - Funds lost", async function () {
    it("Should be able to open a position", async function () {
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const tokenAmount = vaultBalance;
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.connect(manager).openPosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", tokenAmount, true, { value: keepersFee });
      await expect(tx).not.to.be.reverted;

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const vaultDelta = vaultBalance.sub(vaultFinalBalance);
      expect(vaultFinalBalance).to.be.lt(vaultBalance);
      expect(vaultDelta).to.be.eq(tokenAmount);
    });

    it("Should not be able to confirm trades are closed if a position is open", async () => {
      const tx = alphaVault.confirmTradesClosed();
      await expect(tx).to.be.revertedWith("Close all positions on GMX");
    });

    it("Should be able to close a position", async function () {
      // No funds will come back
      const vaultBalance = await usdc.balanceOf(alphaVault.address);
      const tokenAmount = vaultBalance.mul(10).div(100);
      const keepersFee = ethers.utils.parseEther("0.02");

      const tx = alphaVault.connect(manager).closePosition("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", true, {
        value: keepersFee,
      });

      await expect(tx).not.to.be.reverted;
    });

    it("Should be able to confirm all trades are closed", async () => {
      const tx = alphaVault.confirmTradesClosed();
      await expect(tx).not.to.be.reverted;
    });

    it("Should not be able to stop epoch with wrong message value", async function () {
      const tx = alphaVault.stop(110, { value: ethers.utils.parseEther("0.1") });
      await expect(tx).to.be.revertedWith("RedeemLocal requires funds");
    });

    it("Should be able to stop epoch", async function () {
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);
      const tradingWalletInitialBalance = await usdc.balanceOf(tradingEoa.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);

      await alphaVault.stop(110, { value: ethers.utils.parseEther("0.3") });

      // Simulate transfer from LayerZero
      await usdc.connect(usdcWhale).transfer(alphaVault.address, millionDepositAmount.mul(80).div(100));

      await alphaVault.connect(manager).confirmStargateAsyncRedeem();

      const vaultFinalBalance = await usdc.balanceOf(alphaVault.address);
      const tradingWalletFinalBalance = await usdc.balanceOf(tradingEoa.address);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address);

      expect(vaultFinalBalance).to.be.gt(vaultInitialBalance);
      expect(vaultFinalBalance).to.be.lt(millionDepositAmount);
      expect(lpStakingFinalBalance[0]).to.be.lt(lpStakingInitialBalance[0]);
      expect(lpStakingFinalBalance[0]).to.be.eq(0);
    });

    it("Should have an updated total balance", async function () {
      // Deployer: 5M
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
      expect(deployerFinalShares).to.be.eq(deployerInitialShares.div(2));
    });

    it("Should be possible to deposit funds", async function () {
      const deployerInitialBalance = await usdc.balanceOf(deployer.address);
      const vaultInitialBalance = await usdc.balanceOf(alphaVault.address);

      await usdc.connect(deployer).approve(alphaVault.address, depositAmount);
      await alphaVault.deposit(depositAmount, deployerDepositSignature);

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
        const tx = alphaVault.connect(thirdAct).deposit(depositAmount.mul(10), thirdActDepositSignature);
        await expect(tx).not.to.be.reverted;
      });

      it("Should not be able to deposit more than cap", async function () {
        const tx = alphaVault.connect(deployer).deposit(depositAmount, deployerDepositSignature);
        await expect(tx).to.be.revertedWith("Cap reached");
      });
    });

    describe("Start / Stop", async function () {
      it("Should not be possible to start if not owner", async function () {
        const tx = alphaVault.connect(thirdAct).start();
        await expect(tx).to.be.revertedWith("Unauthorized");
      });

      it("Should not be possible to stop if not owner", async function () {
        const tx = alphaVault.connect(thirdAct).stop(110);
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

    describe("Swap router", async function () {
      it("Should not be possible to change swap router if not owner", async function () {
        const tx = alphaVault.connect(thirdAct).setSwapRouter(thirdAct.address);
        await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Should be possible to change swap router if owner", async function () {
        const tx = await alphaVault.connect(deployer).setSwapRouter(thirdAct.address);
        const newManager = await alphaVault.swapRouter();
        expect(newManager).to.be.eq(thirdAct.address);
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

    describe("Deposit limits", async function () {
      const smallDepositAmount = ethers.utils.parseUnits("10", "6");
      before(async () => {
        const totalBalance = await alphaVault.totalBalance();
        await alphaVault.setCap(totalBalance.add(smallDepositAmount));
        await usdc.connect(deployer).approve(alphaVault.address, smallDepositAmount);
      });

      it("Should not be possible to change deposit limits if not owner", async function () {
        const tx = alphaVault.connect(thirdAct).setDepositLimits(10, 50000);
        await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Should be possible to change deposit limits if owner", async function () {
        const tx = alphaVault.connect(deployer).setDepositLimits(10, 50000);
        await expect(tx).not.to.be.reverted;
        const depositTx = alphaVault.deposit(smallDepositAmount, deployerDepositSignature);
        await expect(depositTx).not.to.be.reverted;
      });
    });

    describe("Signer", async function () {
      const smallDepositAmount = ethers.utils.parseUnits("10", "6");
      before(async () => {
        const totalBalance = await alphaVault.totalBalance();
        await alphaVault.setCap(totalBalance.add(smallDepositAmount));
        await usdc.connect(deployer).approve(alphaVault.address, smallDepositAmount);
      });

      it("Should not be possible to change signer if not owner", async function () {
        const tx = alphaVault.connect(thirdAct).setSigner(manager.address);
        await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Should be possible to change signer if owner", async function () {
        const tx = alphaVault.connect(deployer).setSigner(manager.address);
        await expect(tx).not.to.be.reverted;

        const newSignature = await generateDepositSignature(manager, deployer);
        const depositTx = alphaVault.deposit(smallDepositAmount, newSignature);
        await expect(depositTx).not.to.be.reverted;
      });
    });
  });
});
