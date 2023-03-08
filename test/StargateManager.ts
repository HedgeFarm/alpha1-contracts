import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { StargateManager, StargateManagerV2 } from "../typechain-types";
import { BigNumber, Contract } from "ethers";
import { ethers, upgrades } from "hardhat";
import { unlockAddress } from "./helpers/unlockAddress";
import { generateDepositSignature } from "./helpers/generateDepositSignature";
import { expect } from "chai";
import { mineExtraBlocks } from "./helpers/mineExtraBlocks";
import { stargate } from "../typechain-types/contracts/interface";

const erc20Abi = require("./../abi/erc20.json");
const stargateLpStakingAbi = require("./../abi/stargateLpStaking.json");

describe("StargateManager.sol", function () {
  let usdc: Contract;
  const usdcAddress = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
  const usdcDecimals = 6;

  let usdt: Contract;
  const usdtAddress = "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7";
  const usdtDecimals = 6;

  let deployer: SignerWithAddress;
  let secondAct: SignerWithAddress;
  let mockAlphaVault: SignerWithAddress;
  let manager: SignerWithAddress;
  let usdcWhale: SignerWithAddress;
  let usdtWhale: SignerWithAddress;

  let stargateManager: StargateManager;
  let stargateLpStaking: Contract;

  const traderJoeRouter = "0x60aE616a2155Ee3d9A68541Ba4544862310933d4";
  const stargateLpTokenAddress = "0x1205f31718499dBf1fCa446663B532Ef87481fe1";
  const stargateRouterAddress = "0x45A01E4e04F14f7A4a6702c74187c5F6222033cd";
  const stargateRouterPoolId = "1";
  const stargateLpStakingAddress = "0x8731d54E9D02c286767d56ac03e8037C07e01e98";
  const stargateLpStakingPoolId = "0";
  const stgTokenAddress = "0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590";

  const depositAmount = ethers.utils.parseUnits("10000", "6");

  before(async function () {
    [deployer, secondAct, mockAlphaVault] = await ethers.getSigners();
    manager = await unlockAddress("0x39B5BEffbf118a720E9489344b28058F4d6310eA"); // Gnosis Safe

    await deployer.sendTransaction({
      to: manager.address,
      value: ethers.utils.parseEther("1"),
    });

    // Deploy StargateManager
    const StargateManager = await ethers.getContractFactory("StargateManager");
    stargateManager = (await upgrades.deployProxy(
      StargateManager,
      [
        usdcAddress,
        mockAlphaVault.address,
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

    usdc = await ethers.getContractAt(erc20Abi, usdcAddress, usdcWhale);
    usdcWhale = await unlockAddress("0x9f8c163cBA728e99993ABe7495F06c0A3c8Ac8b9");

    usdt = await ethers.getContractAt(erc20Abi, usdtAddress, usdtWhale);
    usdtWhale = await unlockAddress("0x9f8c163cBA728e99993ABe7495F06c0A3c8Ac8b9");

    stargateLpStaking = await ethers.getContractAt(stargateLpStakingAbi, stargateLpStakingAddress, usdcWhale);
  });

  describe("Proxy owner", function () {
    it("Should be the deployer the owner", async function () {
      const owner = await stargateManager.owner();
      expect(owner).to.be.eq(deployer.address);
    });

    it("Should be possible to change the owner", async function () {
      const previousOwner = await stargateManager.owner();
      await stargateManager.transferOwnership(manager.address);
      const newOwner = await stargateManager.owner();

      expect(previousOwner).to.be.eq(deployer.address);
      expect(newOwner).to.be.eq(manager.address);
    });
  });

  describe("Deposit", function () {
    before(async () => {
      // Transder USDC to deployer
      await usdc.connect(usdcWhale).transfer(deployer.address, depositAmount.mul(10));
      await usdc.connect(usdcWhale).transfer(mockAlphaVault.address, depositAmount.mul(10));
      // Simulate AlphaVault by approving
      await usdc.connect(deployer).approve(stargateManager.address, depositAmount);
      await usdc.connect(mockAlphaVault).approve(stargateManager.address, depositAmount);
    });

    it("Shouldn't be able to deposit if it's not vault", async () => {
      const tx = stargateManager.connect(deployer).deposit(depositAmount);
      await expect(tx).to.be.revertedWith("Not vault");
    });

    it("Should be able to deposit if vault", async () => {
      const contractInitialBalance = await usdc.balanceOf(stargateManager.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo("0", stargateManager.address);

      await stargateManager.connect(mockAlphaVault).deposit(depositAmount);

      const contractFinalBalance = await usdc.balanceOf(stargateManager.address);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo("0", stargateManager.address);

      expect(contractInitialBalance).to.be.eq(0);
      expect(contractFinalBalance).to.be.eq(0);
      expect(lpStakingInitialBalance[0]).to.be.eq(0);
      expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0]);
    });
  });

  describe("Harvest", function () {
    it("Should be able to harvest and autocompound", async () => {
      await mineExtraBlocks(500);

      const contractInitialBalance = await usdc.balanceOf(stargateManager.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo("0", stargateManager.address);

      await stargateManager.connect(mockAlphaVault).harvest(true);

      const contractFinalBalance = await usdc.balanceOf(stargateManager.address);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo("0", stargateManager.address);

      expect(contractInitialBalance).to.be.eq(0);
      expect(contractFinalBalance).to.be.eq(0);
      expect(lpStakingInitialBalance[0]).not.to.be.eq(0);
      expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0]);
    });

    it("Should be able to harvest and not autocompound", async () => {
      await mineExtraBlocks(500);

      const contractInitialBalance = await usdc.balanceOf(stargateManager.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo("0", stargateManager.address);

      await stargateManager.connect(mockAlphaVault).harvest(false);

      const contractFinalBalance = await usdc.balanceOf(stargateManager.address);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo("0", stargateManager.address);

      expect(contractInitialBalance).to.be.eq(0);
      expect(contractFinalBalance).to.be.gt(contractInitialBalance);
      expect(lpStakingInitialBalance[0]).not.to.be.eq(0);
      expect(lpStakingFinalBalance[0]).to.be.eq(lpStakingInitialBalance[0]);
    });
  });

  describe("Withdraw", function () {
    it("Shouldn't be able to withdraw if it's not vault", async () => {
      const tx = stargateManager.connect(deployer).withdraw();
      await expect(tx).to.be.revertedWith("Not vault");
    });

    it("Should be able to withdraw if vault", async () => {
      const vaultInitialBalance = await usdc.balanceOf(mockAlphaVault.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo("0", stargateManager.address);

      await stargateManager.connect(mockAlphaVault).withdraw();

      const vaultFinalBalance = await usdc.balanceOf(mockAlphaVault.address);
      const delta = vaultFinalBalance.sub(vaultInitialBalance);
      const managerFinalBalance = await usdc.balanceOf(stargateManager.address);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo("0", stargateManager.address);

      expect(vaultFinalBalance).to.be.gt(vaultInitialBalance);
      expect(delta).to.be.gt(depositAmount);
      expect(managerFinalBalance).to.be.eq(0);
      expect(lpStakingInitialBalance[0]).to.be.gt(0);
      expect(lpStakingFinalBalance[0]).to.be.eq(0);
    });
  });

  describe("Withdraw async", function () {
    const bigDepositAmount = ethers.utils.parseUnits("20000000", "6");
    const withdrawalValue = ethers.utils.parseEther("0.3");

    before(async () => {
      await usdc.connect(usdcWhale).transfer(mockAlphaVault.address, bigDepositAmount);
      await usdc.connect(mockAlphaVault).approve(stargateManager.address, bigDepositAmount);
      await stargateManager.connect(mockAlphaVault).deposit(bigDepositAmount);
    });

    it("Should not be able to request an async withdrawal with a wrong chainPath", async function () {
      // Break chainPath
      await stargateManager
        .connect(manager)
        .setStargateParameters(
          stargateLpTokenAddress,
          stargateRouterAddress,
          stargateRouterPoolId,
          stargateLpStakingAddress,
          stargateLpStakingPoolId,
          stgTokenAddress,
          [stgTokenAddress],
          0
        );

      const tx = stargateManager.connect(mockAlphaVault).withdraw({ value: withdrawalValue });
      await expect(tx).to.be.revertedWith("Stargate: local chainPath does not exist");

      // Fix chainPath
      await stargateManager
        .connect(manager)
        .setStargateParameters(
          stargateLpTokenAddress,
          stargateRouterAddress,
          stargateRouterPoolId,
          stargateLpStakingAddress,
          stargateLpStakingPoolId,
          stgTokenAddress,
          [stgTokenAddress],
          110
        );
    });

    it("Should be able to request an async withdrawal from Stargate", async function () {
      const vaultInitialBalance = await usdc.balanceOf(mockAlphaVault.address);
      const managerInitialBalance = await usdc.balanceOf(stargateManager.address);
      const lpStakingInitialBalance = await stargateLpStaking.userInfo("0", stargateManager.address);

      await stargateManager.connect(mockAlphaVault).withdraw({ value: withdrawalValue });

      const vaultFinalBalance = await usdc.balanceOf(mockAlphaVault.address);
      const managerFinalBalance = await usdc.balanceOf(stargateManager.address);
      const lpStakingFinalBalance = await stargateLpStaking.userInfo("0", stargateManager.address);

      expect(vaultFinalBalance).to.be.gte(vaultInitialBalance); // Harvest funds transferred to vault if something was to swap
      expect(managerInitialBalance).to.be.eq(managerFinalBalance).to.be.eq(0);
      expect(lpStakingInitialBalance[0]).to.be.gt(0);
      expect(lpStakingFinalBalance[0]).to.be.eq(0);
    });
  });

  describe("Set token", function () {
    const updatedToken = "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7";

    it("Shouldn't be able to set new token if not owner", async function () {
      const tx = stargateManager.connect(secondAct).setToken(updatedToken);
      await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Shouldn't be able to set new token as address(0)", async function () {
      const tx = stargateManager.connect(manager).setToken("0x0000000000000000000000000000000000000000");
      await expect(tx).to.be.revertedWith("Address can't be 0");
    });

    it("Should be able to set new token if owner", async function () {
      const previousToken = await stargateManager.token();

      await stargateManager.connect(manager).setToken(updatedToken);

      const newToken = await stargateManager.token();
      expect(previousToken).to.be.eq(usdc.address);
      expect(newToken).to.be.eq(updatedToken);
    });
  });

  describe("Set vault", function () {
    const updatedMockAlphaVault = "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7";

    it("Shouldn't be able to set new vault if not owner", async function () {
      const tx = stargateManager.connect(secondAct).setVault(updatedMockAlphaVault);
      await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Shouldn't be able to set new vault as address(0)", async function () {
      const tx = stargateManager.connect(manager).setVault("0x0000000000000000000000000000000000000000");
      await expect(tx).to.be.revertedWith("Address can't be 0");
    });

    it("Should be able to set new vault if owner", async function () {
      const previousVault = await stargateManager.vault();

      await stargateManager.connect(manager).setVault(updatedMockAlphaVault);

      const newVault = await stargateManager.vault();
      expect(previousVault).to.be.eq(mockAlphaVault.address);
      expect(newVault).to.be.eq(updatedMockAlphaVault);
    });
  });

  describe("Manager", async function () {
    it("Should not be possible to change manager if not owner", async function () {
      const tx = stargateManager.connect(secondAct).setManager(secondAct.address);
      await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Shouldn't be able to set new manager as address(0)", async function () {
      const tx = stargateManager.connect(manager).setManager("0x0000000000000000000000000000000000000000");
      await expect(tx).to.be.revertedWith("Address can't be 0");
    });

    it("Should be possible to change manager if owner", async function () {
      const tx = await stargateManager.connect(manager).setManager(secondAct.address);
      const newManager = await stargateManager.manager();
      expect(newManager).to.be.eq(secondAct.address);
    });
  });

  describe("Set swap router", function () {
    const updatedRouter = "0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106";

    it("Shouldn't be able to set new swap router if not owner", async function () {
      const tx = stargateManager.connect(secondAct).setSwapRouter(updatedRouter);
      await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Shouldn't be able to set new swap router as address(0)", async function () {
      const tx = stargateManager.connect(manager).setSwapRouter("0x0000000000000000000000000000000000000000");
      await expect(tx).to.be.revertedWith("Address can't be 0");
    });

    it("Should be able to set new swap router if owner", async function () {
      const previousRouter = await stargateManager.swapRouter();

      await stargateManager.connect(manager).setSwapRouter(updatedRouter);

      const newRouter = await stargateManager.swapRouter();
      expect(previousRouter).to.be.eq(traderJoeRouter);
      expect(newRouter).to.be.eq(updatedRouter);
    });
  });

  describe("Funds stuck", function () {
    const usdcAmount = ethers.utils.parseUnits("100", usdcDecimals);
    const usdtAmount = ethers.utils.parseUnits("100", usdtDecimals);

    const susdcAddress = "0x1205f31718499dBf1fCa446663B532Ef87481fe1";

    before(async () => {
      await stargateManager.connect(manager).setToken(usdc.address);
      await stargateManager.connect(manager).setVault(mockAlphaVault.address);

      await usdc.connect(usdcWhale).transfer(stargateManager.address, usdcAmount);
      await usdt.connect(usdtWhale).transfer(stargateManager.address, usdtAmount);

      const susdcWhale = await unlockAddress("0x444e01DCb3A1eC1b1aa1344505ed7C8690D53281");
      const susdc: Contract = await ethers.getContractAt(erc20Abi, susdcAddress, susdcWhale);
      await susdc.connect(susdcWhale).transfer(stargateManager.address, ethers.utils.parseUnits("100", "6"));
    });

    it("Should be able to send USDC back to vault", async () => {
      const managerInitialBalance = await usdc.balanceOf(stargateManager.address);
      const vaultInitialBalance = await usdc.balanceOf(mockAlphaVault.address);

      await stargateManager.connect(mockAlphaVault).withdrawToken();

      const managerFinalBalance = await usdc.balanceOf(stargateManager.address);
      const vaultFinalBalance = await usdc.balanceOf(mockAlphaVault.address);
      const vaultDelta = vaultFinalBalance.sub(vaultInitialBalance);

      expect(managerInitialBalance).to.be.eq(usdcAmount);
      expect(managerFinalBalance).to.be.eq(0);
      expect(vaultDelta).to.be.eq(usdcAmount);
    });

    it("Should not be possible to rescue USDC", async () => {
      const tx = stargateManager.connect(manager).rescue(usdc.address, mockAlphaVault.address);
      await expect(tx).to.be.revertedWith("No rug");
    });

    it("Should not be possible to rescue Stargate LP", async () => {
      const tx = stargateManager.connect(manager).rescue(susdcAddress, mockAlphaVault.address);
      await expect(tx).to.be.revertedWith("No rug");
    });

    it("Should be possible to rescue USDT", async () => {
      const managerInitialBalance = await usdt.balanceOf(stargateManager.address);
      const vaultInitialBalance = await usdt.balanceOf(mockAlphaVault.address);

      await stargateManager.connect(manager).rescue(usdt.address, mockAlphaVault.address);

      const managerFinalBalance = await usdt.balanceOf(stargateManager.address);
      const vaultFinalBalance = await usdt.balanceOf(mockAlphaVault.address);
      const vaultDelta = vaultFinalBalance.sub(vaultInitialBalance);

      expect(managerInitialBalance).to.be.eq(usdtAmount);
      expect(managerFinalBalance).to.be.eq(0);
      expect(vaultDelta).to.be.eq(usdtAmount);
    });
  });

  describe("Set Stargate parameters", function () {
    const updatedLpToken = "0x29e38769f23701A2e4A8Ef0492e19dA4604Be62c";
    const updatedRouter = "0x8731d54E9D02c286767d56ac03e8037C07e01e98";
    const updatedRouterPoolId = "9";
    const updatedLpStaking = "0x3052A0F6ab15b4AE1df39962d5DdEFacA86DaB47";
    const updatedLpStakingPoolId = "9";
    const updatedStgToken = "0xB0D502E938ed5f4df2E681fE6E419ff29631d62b";
    const updatedRewards = ["0xB0D502E938ed5f4df2E681fE6E419ff29631d62b"];
    const updatedWithdrawRemoteChainId = 109;

    it("Shouldn't be able to set new Stargate parameters if not owner", async function () {
      const tx = stargateManager
        .connect(secondAct)
        .setStargateParameters(
          updatedLpToken,
          updatedRouter,
          updatedRouterPoolId,
          updatedLpStaking,
          updatedLpStakingPoolId,
          updatedStgToken,
          updatedRewards,
          updatedWithdrawRemoteChainId
        );
      await expect(tx).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should be able to set new swap router if owner", async function () {
      const previousLpToken = await stargateManager.stargateLpToken();
      const previousRouter = await stargateManager.stargateRouter();
      const previousRouterPoolId = await stargateManager.stargateRouterPoolId();
      const previousLpStaking = await stargateManager.stargateLpStaking();
      const previousLpStakingPoolId = await stargateManager.stargateLpStakingPoolId();
      const previousStgToken = await stargateManager.stgToken();
      const previousRewards = await stargateManager.rewards(0);
      const previousWithdrawRemoteChainId = await stargateManager.withdrawRemoteChainId();

      await stargateManager
        .connect(manager)
        .setStargateParameters(
          updatedLpToken,
          updatedRouter,
          updatedRouterPoolId,
          updatedLpStaking,
          updatedLpStakingPoolId,
          updatedStgToken,
          updatedRewards,
          updatedWithdrawRemoteChainId
        );

      const newLpToken = await stargateManager.stargateLpToken();
      const newRouter = await stargateManager.stargateRouter();
      const newRouterPoolId = await stargateManager.stargateRouterPoolId();
      const newLpStaking = await stargateManager.stargateLpStaking();
      const newLpStakingPoolId = await stargateManager.stargateLpStakingPoolId();
      const newStgToken = await stargateManager.stgToken();
      const newRewards = await stargateManager.rewards(0);
      const newWithdrawRemoteChainId = await stargateManager.withdrawRemoteChainId();

      expect(previousLpToken).to.be.eq(stargateLpTokenAddress);
      expect(newLpToken).to.be.eq(updatedLpToken);
      expect(previousRouter).to.be.eq(stargateRouterAddress);
      expect(newRouter).to.be.eq(updatedRouter);
      expect(previousRouterPoolId.toString()).to.be.eq(stargateRouterPoolId);
      expect(newRouterPoolId.toString()).to.be.eq(updatedRouterPoolId);
      expect(previousLpStaking).to.be.eq(stargateLpStaking.address);
      expect(newLpStaking).to.be.eq(updatedLpStaking);
      expect(previousLpStakingPoolId.toString()).to.be.eq(stargateLpStakingPoolId);
      expect(newLpStakingPoolId.toString()).to.be.eq(updatedLpStakingPoolId);
      expect(previousStgToken).to.be.eq(stgTokenAddress);
      expect(newStgToken).to.be.eq(updatedStgToken);
      expect(previousRewards).to.be.eq(stgTokenAddress);
      expect(newRewards).to.be.eq(updatedRewards[0]);
      expect(previousWithdrawRemoteChainId).to.be.eq(110);
      expect(newWithdrawRemoteChainId).to.be.eq(updatedWithdrawRemoteChainId);
    });
  });

  describe("Upgrade", async function () {
    let newStargateManager: StargateManagerV2;
    it("Should be able to upgrade the implementation", async function () {
      const previousImplementation = await stargateManager.getImplementation();
      const previousWithdrawRemoteChainId = await stargateManager.withdrawRemoteChainId();

      const StargateManagerV2 = await ethers.getContractFactory("StargateManagerV2", manager);
      newStargateManager = (await upgrades.upgradeProxy(stargateManager.address, StargateManagerV2, {
        call: "initializeV2",
      })) as StargateManagerV2;

      const newImplementation = await stargateManager.getImplementation();
      const newWithdrawRemoteChainId = await stargateManager.withdrawRemoteChainId();

      expect(stargateManager.address).to.be.eq(newStargateManager.address);
      expect(newImplementation).not.to.be.eq(previousImplementation);
      expect(newWithdrawRemoteChainId).not.to.be.eq(previousWithdrawRemoteChainId);
    });

    it("Should have a new value", async function () {
      const newVariable = await newStargateManager.answer();
      expect(newVariable).to.be.eq(42);
    });
  });
});
