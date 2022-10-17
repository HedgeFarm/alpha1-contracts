import { expect } from "chai";
import { ethers } from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {AlphaVaultBSC} from "../../typechain-types";
import {unlockAddress} from "../../test/helpers/unlockAddress";
import {BigNumber, Contract, Signer} from "ethers";
import {Sign} from "crypto";
import {mineExtraBlocks} from "../../test/helpers/mineExtraBlocks";

const erc20Abi = require("../../abi/erc20.json");
const stargateLpStakingAbi = require("../../abi/stargateLpStaking.json");
const depositAmount = ethers.utils.parseEther("1000")
const halfDepositAmount = depositAmount.div(2)

describe("AlphaVault-BSC", function () {
    let deployer: SignerWithAddress;
    let secondAct: SignerWithAddress;
    let thirdAct: SignerWithAddress;
    let tradingEoa: SignerWithAddress;

    let alphaVault: AlphaVaultBSC;
    let busd: Contract;
    let busdWhale: SignerWithAddress;

    const stargateLpStakingPoolId = 1;
    let stargateLpStaking: Contract;

    // Epoch 0
    let finalEpoch0TotalBalance: BigNumber;
    let finalEpoch0PricePerShare: BigNumber;

    before(async function() {
        [deployer, secondAct, thirdAct] = await ethers.getSigners();
        tradingEoa = await unlockAddress("0xe0a2f6EBF3E316cd38EEdd40ccd37Ac0A91280c4")
        const cap = ethers.utils.parseEther("10000")
        const pancakeSwapRouter = "0x10ED43C718714eb63d5aA57B78B54704E256024E"
        const stargateLpStakingAddress = "0x3052A0F6ab15b4AE1df39962d5DdEFacA86DaB47"
        const stargateRouterAddress = "0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8"
        const stargateLpTokenAddress = "0x98a5737749490856b401DB5Dc27F522fC314A4e1"
        const stgTokenAddress = "0xB0D502E938ed5f4df2E681fE6E419ff29631d62b"
        const stargateRouterPoolId = "5"
        const AlphaVault = await ethers.getContractFactory("AlphaVaultBSC");
        alphaVault = await AlphaVault.deploy("HedgeFarm Alpha 1 IOU", "hedgeAlpha1", "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", tradingEoa.address, cap, stargateLpStakingAddress, stargateLpTokenAddress, stargateRouterPoolId, stargateLpStakingPoolId);

        busdWhale = await unlockAddress("0x8894E0a0c962CB723c1976a4421c95949bE2D4E3")
        busd = await ethers.getContractAt(erc20Abi, "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", busdWhale)
        stargateLpStaking = await ethers.getContractAt(stargateLpStakingAbi, stargateLpStakingAddress, busdWhale)
    })

    describe("Deployment", function () {
        it("Should deploy the contract", async function () {
            expect(alphaVault.address).not.to.equal("0x");
        });

        it("Should have the right name", async function () {
            const name = await alphaVault.name()
            expect(name).to.equal("HedgeFarm Alpha 1 IOU");
        });
    })

    describe("Pre-epoch", function () {
        before(async function () {
            // Fund deployer with BUSD
            await busd.transfer(deployer.address, depositAmount.mul(10))
            await busd.transfer(secondAct.address, depositAmount.mul(10))
            await busd.transfer(thirdAct.address, depositAmount.mul(10))
            // Fund trading wallet with BNB
            await deployer.sendTransaction({to: tradingEoa.address, value: ethers.utils.parseEther("1")})
        })

        it("Should have received 10k BUSD", async function () {
            expect(await busd.balanceOf(deployer.address)).to.be.eq(depositAmount.mul(10))
        })

        it("Should be able to deposit pre-epoch", async function () {
            const deployerInitialBalance = await busd.balanceOf(deployer.address)
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)

            await busd.connect(deployer).approve(alphaVault.address, depositAmount)
            await alphaVault.deposit(depositAmount)

            const deployerFinalBalance = await busd.balanceOf(deployer.address)
            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const deployerShares = await alphaVault.balanceOf(deployer.address)

            expect(deployerFinalBalance).to.be.lt(deployerInitialBalance)
            expect(vaultFinalBalance).to.be.gt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.eq(depositAmount)
            expect(deployerShares).to.be.eq(depositAmount)
        })

        it("Should not be possible to deposit more than cap", async function () {
            const tx = alphaVault.deposit(depositAmount.mul(10))
            await expect(tx).to.be.revertedWith("Cap reached")
        })

        it("Should be possible to withdraw 50%", async function () {
            const deployerInitialBalance = await busd.balanceOf(deployer.address)
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)
            const deployerInitialShares = await alphaVault.balanceOf(deployer.address)

            await alphaVault.withdraw(deployerInitialShares.div(2))

            const deployerFinalBalance = await busd.balanceOf(deployer.address)
            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const deployerFinalShares = await alphaVault.balanceOf(deployer.address)

            // We withdrew 50%, so we only have 5k left
            expect(deployerFinalBalance).to.be.gt(deployerInitialBalance)
            expect(vaultFinalBalance).to.be.lt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.eq(halfDepositAmount)
            expect(deployerFinalShares).to.be.lt(deployerInitialShares)
            expect(deployerFinalShares).to.be.eq(halfDepositAmount)
        })

        it("Should have correct IOU for a second deposit", async function () {
            const secondActInitialBalance = await busd.balanceOf(secondAct.address)
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)

            await busd.connect(secondAct).approve(alphaVault.address, depositAmount)
            await alphaVault.connect(secondAct).deposit(depositAmount)

            const secondActFinalBalance = await busd.balanceOf(secondAct.address)
            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const secondActShares = await alphaVault.balanceOf(secondAct.address)

            // We add 1k on top of the remaining 0.5k
            expect(secondActFinalBalance).to.be.lt(secondActInitialBalance)
            expect(vaultFinalBalance).to.be.gt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.eq(halfDepositAmount.add(depositAmount))
            expect(secondActShares).to.be.eq(depositAmount)
        })

        it("Should have a correct total balance", async function () {
            // Deployer: 0.5k + SecondAct: 1k = 1.5k
            expect(await alphaVault.totalBalance()).to.be.eq(halfDepositAmount.add(depositAmount))
        })

        it("Should have a correct price per share", async function () {
            expect(await alphaVault.pricePerShare()).to.be.eq(ethers.utils.parseEther("1"))
        })
    })

    describe("Start Epoch 0", function () {
        it("Should deposit in Stargate and send funds to trading wallet", async function () {
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletInitialBalance = await busd.balanceOf(tradingEoa.address)
            const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            await alphaVault.start()

            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletFinalBalance = await busd.balanceOf(tradingEoa.address)
            const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            expect(vaultFinalBalance).to.be.lt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.eq(0)
            expect(tradingWalletFinalBalance).to.be.gt(tradingWalletInitialBalance)
            expect(tradingWalletFinalBalance).to.be.eq(vaultInitialBalance.mul(20).div(100))
            expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0])
        })

        it("Should have a cached total balance", async function () {
            // Deployer: 0.5k + SecondAct: 1k = 1.5k
            // Cached when we `start`
            expect(await alphaVault.totalBalance()).to.be.eq(halfDepositAmount.add(depositAmount))
        })

        it("Should have a cached price per share", async function () {
            // Cached when we start
            expect(await alphaVault.pricePerShare()).to.be.eq(ethers.utils.parseEther("1"))
        })

        it("Should not be possible to deposit", async function () {
            const tx = alphaVault.deposit(depositAmount)
            await expect(tx).to.be.revertedWith("Disabled when during epoch")
        })

        it("Should not be possible to withdraw", async function () {
            const tx = alphaVault.withdraw(1)
            await expect(tx).to.be.revertedWith("Disabled when during epoch")
        })
    })

    describe("Stop Epoch 0", async function () {
        before(async function () {
            await mineExtraBlocks(100)
        })

        it("Should be possible to harvest and autocompound", async function () {
            const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            await alphaVault.harvest(true)

            const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0])
        })

        it("Should not be able to stop before stopTrading is called", async function () {
            const tx = alphaVault.stop()
            await expect(tx).to.be.revertedWith("Return first trading funds")
        })

        it("Should be able to receive funds from trading wallet", async function () {
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletInitialBalance = await busd.balanceOf(tradingEoa.address)
            const isTradingInitial = await alphaVault.isTrading()

            const tradingWalletBalance = await busd.balanceOf(tradingEoa.address)
            await busd.connect(tradingEoa).approve(alphaVault.address, tradingWalletBalance)

            await alphaVault.stopTrading(tradingWalletBalance)

            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletFinalBalance = await busd.balanceOf(tradingEoa.address)
            const isTradingFinal = await alphaVault.isTrading()

            expect(isTradingInitial).to.be.eq(true)
            expect(isTradingFinal).to.be.eq(false)
            expect(vaultFinalBalance).to.be.gt(vaultInitialBalance)
            expect(tradingWalletFinalBalance).to.be.lt(tradingWalletInitialBalance)
            expect(tradingWalletFinalBalance).to.be.eq(0)
        })

        it("Should be able to stop epoch", async function () {
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)
            const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            await alphaVault.stop()

            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            expect(vaultFinalBalance).to.be.gt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.gt(depositAmount.add(halfDepositAmount))
            expect(lpStakingFinalBalance[0]).to.be.lt(lpStakingInitialBalance[0])
            expect(lpStakingFinalBalance[0]).to.be.eq(0)
        })

        it("Should have an updated total balance", async function () {
            // Deployer: 0.5k + SecondAct: 1k = 1.5k
            // We had some rewards
            finalEpoch0TotalBalance = await alphaVault.totalBalance()
            expect(finalEpoch0TotalBalance).to.be.gt(halfDepositAmount.add(depositAmount))
        })

        it("Should have an updated price per share", async function () {
            // Cached when we start
            finalEpoch0PricePerShare = await alphaVault.pricePerShare()
            expect(finalEpoch0PricePerShare).to.be.gt(ethers.utils.parseEther("1"))
        })

        it("Should not be possible to withdraw more shares than owned", async function () {
            const totalShares = await alphaVault.totalSupply()

            const tx = alphaVault.withdraw(totalShares)
            await expect(tx).to.be.revertedWith("Not enough shares")
        })

        it("Should be possible to withdraw funds", async function () {
            const deployerInitialBalance = await busd.balanceOf(deployer.address)
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)
            const deployerInitialShares = await alphaVault.balanceOf(deployer.address)

            await alphaVault.withdraw(deployerInitialShares)

            const deployerFinalBalance = await busd.balanceOf(deployer.address)
            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const deployerFinalShares = await alphaVault.balanceOf(deployer.address)

            const deployerDelta = deployerFinalBalance.sub(deployerInitialBalance)

            // We withdrew the rest of the deployer shares, only secondAct's 1k left
            expect(deployerFinalBalance).to.be.gt(deployerInitialBalance)
            expect(deployerDelta).to.be.gt(ethers.utils.parseEther("500"))
            expect(vaultFinalBalance).to.be.lt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.gt(depositAmount)
            expect(deployerFinalShares).to.be.lt(deployerInitialShares)
            expect(deployerFinalShares).to.be.eq(0)
        })

        it("Should be possible to deposit funds", async function () {
            const deployerInitialBalance = await busd.balanceOf(deployer.address)
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)

            await busd.connect(deployer).approve(alphaVault.address, depositAmount)
            await alphaVault.deposit(depositAmount)

            const deployerFinalBalance = await busd.balanceOf(deployer.address)
            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const deployerShares = await alphaVault.balanceOf(deployer.address)

            // We now have two deposits of 1k = 2k
            // Shares are worth > 1, so less shares than amount
            expect(deployerFinalBalance).to.be.lt(deployerInitialBalance)
            expect(vaultFinalBalance).to.be.gt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.gt(depositAmount.mul(2))
            expect(deployerShares).to.be.lt(depositAmount)
        })
    })

    describe("Start Epoch 1", function () {
        it("Should deposit in Stargate and send funds to trading wallet", async function () {
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletInitialBalance = await busd.balanceOf(tradingEoa.address)
            const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            await alphaVault.start()

            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletFinalBalance = await busd.balanceOf(tradingEoa.address)
            const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            expect(vaultFinalBalance).to.be.lt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.eq(0)
            expect(tradingWalletInitialBalance).to.be.eq(0)
            expect(tradingWalletFinalBalance).to.be.gt(tradingWalletInitialBalance)
            expect(tradingWalletFinalBalance).to.be.eq(vaultInitialBalance.mul(20).div(100)) // TODO
            expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0])
        })

        it("Should have a cached total balance", async function () {
            // Deployer: 0.5k + SecondAct: 1k = 1.5k
            // Cached when we `start`
            expect(await alphaVault.totalBalance()).to.be.gt(depositAmount.mul(2))
        })

        it("Should have a cached price per share", async function () {
            // Cached when we start
            expect(await alphaVault.pricePerShare()).to.be.gt(ethers.utils.parseEther("1"))
        })

        it("Should not be possible to deposit", async function () {
            const tx = alphaVault.deposit(depositAmount)
            await expect(tx).to.be.revertedWith("Disabled when during epoch")
        })

        it("Should not be possible to withdraw", async function () {
            const tx = alphaVault.withdraw(1)
            await expect(tx).to.be.revertedWith("Disabled when during epoch")
        })
    })

    describe("Stop Epoch 1", async function () {
        before(async function () {
            await mineExtraBlocks(100)
        })

        it("Should be possible to harvest and autocompound", async function () {
            const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            await alphaVault.harvest(true)

            const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0])
        })

        it("Should be able to receive funds from trading wallet", async function () {
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletInitialBalance = await busd.balanceOf(tradingEoa.address)
            const isTradingInitial = await alphaVault.isTrading()

            const tradingWalletBalance = await busd.balanceOf(tradingEoa.address)
            await busd.connect(tradingEoa).approve(alphaVault.address, tradingWalletBalance)

            await alphaVault.stopTrading(tradingWalletBalance)

            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletFinalBalance = await busd.balanceOf(tradingEoa.address)
            const isTradingFinal = await alphaVault.isTrading()

            expect(isTradingInitial).to.be.eq(true)
            expect(isTradingFinal).to.be.eq(false)
            expect(vaultFinalBalance).to.be.gt(vaultInitialBalance)
            expect(tradingWalletFinalBalance).to.be.lt(tradingWalletInitialBalance)
            expect(tradingWalletFinalBalance).to.be.eq(0)
        })

        it("Should be able to stop epoch", async function () {
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletInitialBalance = await busd.balanceOf(tradingEoa.address)
            const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            await alphaVault.stop()

            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletFinalBalance = await busd.balanceOf(tradingEoa.address)
            const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            expect(vaultFinalBalance).to.be.gt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.gt(depositAmount.add(halfDepositAmount))
            expect(lpStakingFinalBalance[0]).to.be.lt(lpStakingInitialBalance[0])
            expect(lpStakingFinalBalance[0]).to.be.eq(0)
        })

        it("Should have an updated total balance", async function () {
            // Deployer: 0.5k + SecondAct: 1k = 1.5k
            // We had some rewards
            expect(await alphaVault.totalBalance()).to.be.gt(finalEpoch0TotalBalance)
        })

        it("Should have an updated price per share", async function () {
            // Cached when we start
            expect(await alphaVault.pricePerShare()).to.be.gt(finalEpoch0PricePerShare)
        })

        it("Should be possible to withdraw funds", async function () {
            const deployerInitialBalance = await busd.balanceOf(deployer.address)
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)
            const deployerInitialShares = await alphaVault.balanceOf(deployer.address)

            await alphaVault.withdraw(deployerInitialShares)

            const deployerFinalBalance = await busd.balanceOf(deployer.address)
            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const deployerFinalShares = await alphaVault.balanceOf(deployer.address)

            const deployerDelta = deployerFinalBalance.sub(deployerInitialBalance)

            // We withdrew all the deployer shares (1k+), only secondAct's 1k left
            expect(deployerFinalBalance).to.be.gt(deployerInitialBalance)
            expect(deployerDelta).to.be.gt(ethers.utils.parseEther("1000"))
            expect(vaultFinalBalance).to.be.lt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.gt(depositAmount)
            expect(deployerFinalShares).to.be.lt(deployerInitialShares)
            expect(deployerFinalShares).to.be.eq(0)
        })

        it("Should be possible to deposit funds", async function () {
            const deployerInitialBalance = await busd.balanceOf(deployer.address)
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)

            await busd.connect(deployer).approve(alphaVault.address, depositAmount)
            await alphaVault.deposit(depositAmount)

            const deployerFinalBalance = await busd.balanceOf(deployer.address)
            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const deployerShares = await alphaVault.balanceOf(deployer.address)

            // We now have two deposits of 1k = 2k
            // Shares are worth > 1, so less shares than amount
            expect(deployerFinalBalance).to.be.lt(deployerInitialBalance)
            expect(vaultFinalBalance).to.be.gt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.gt(depositAmount.mul(2))
            expect(deployerShares).to.be.lt(depositAmount)
        })

        it("Should not be possible to deposit more than cap", async function () {
            const tx = alphaVault.deposit(depositAmount.mul(10))
            await expect(tx).to.be.revertedWith("Cap reached")
        })
    })

    describe("Start Epoch 2", function () {
        it("Should deposit in Stargate and send funds to trading wallet", async function () {
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletInitialBalance = await busd.balanceOf(tradingEoa.address)
            const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            await alphaVault.start()

            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletFinalBalance = await busd.balanceOf(tradingEoa.address)
            const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            expect(vaultFinalBalance).to.be.lt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.eq(0)
            expect(tradingWalletFinalBalance).to.be.gt(tradingWalletInitialBalance)
            expect(tradingWalletFinalBalance).to.be.eq(vaultInitialBalance.mul(20).div(100)) // TODO
            expect(lpStakingFinalBalance[0]).to.be.gt(lpStakingInitialBalance[0])
        })
    })

    describe("Stop Epoch 2 - Funds lost", async function () {
        it("Should be able to stop trading", async function () {
            const isTradingInitial = await alphaVault.isTrading()
            expect(isTradingInitial).to.be.eq(true)

            // Lost funds, still stop trading
            await alphaVault.stopTrading(BigNumber.from("0"))

            const isTradingFinal = await alphaVault.isTrading()
            expect(isTradingFinal).to.be.eq(false)
        })

        it("Should be able to stop epoch", async function () {
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletInitialBalance = await busd.balanceOf(tradingEoa.address)
            const lpStakingInitialBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            await alphaVault.stop()

            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const tradingWalletFinalBalance = await busd.balanceOf(tradingEoa.address)
            const lpStakingFinalBalance = await stargateLpStaking.userInfo(stargateLpStakingPoolId, alphaVault.address)

            expect(vaultFinalBalance).to.be.gt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.gt(depositAmount.add(halfDepositAmount))
            expect(lpStakingFinalBalance[0]).to.be.lt(lpStakingInitialBalance[0])
            expect(lpStakingFinalBalance[0]).to.be.eq(0)
        })

        it("Should have an updated total balance", async function () {
            // Deployer: 1k + SecondAct: 1k = 2k
            // Lost 20% of capital
            expect(await alphaVault.totalBalance()).to.be.lt(ethers.utils.parseEther("2000"))
        })

        it("Should have an updated price per share", async function () {
            // Lost 20% of capital
            expect(await alphaVault.pricePerShare()).to.be.lt(ethers.utils.parseEther("1"))
        })

        it("Should be possible to withdraw funds", async function () {
            const deployerInitialBalance = await busd.balanceOf(deployer.address)
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)
            const deployerInitialShares = await alphaVault.balanceOf(deployer.address)

            await alphaVault.withdraw(deployerInitialShares)

            const deployerFinalBalance = await busd.balanceOf(deployer.address)
            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const deployerFinalShares = await alphaVault.balanceOf(deployer.address)

            const deployerDelta = deployerFinalBalance.sub(deployerInitialBalance)

            // We withdrew all the deployer shares (1k-), only secondAct's 1k left
            expect(deployerFinalBalance).to.be.gt(deployerInitialBalance)
            expect(deployerDelta).to.be.lt(ethers.utils.parseEther("1000"))
            expect(vaultFinalBalance).to.be.lt(vaultInitialBalance)
            expect(vaultFinalBalance).to.be.lt(depositAmount)
            expect(deployerFinalShares).to.be.lt(deployerInitialShares)
            expect(deployerFinalShares).to.be.eq(0)
        })

        it("Should be possible to deposit funds", async function () {
            const deployerInitialBalance = await busd.balanceOf(deployer.address)
            const vaultInitialBalance = await busd.balanceOf(alphaVault.address)

            await busd.connect(deployer).approve(alphaVault.address, depositAmount)
            await alphaVault.deposit(depositAmount)

            const deployerFinalBalance = await busd.balanceOf(deployer.address)
            const vaultFinalBalance = await busd.balanceOf(alphaVault.address)
            const deployerShares = await alphaVault.balanceOf(deployer.address)

            // We now have two deposits of 1k = 2k
            // Shares are worth < 1, so more shares than amount
            expect(deployerFinalBalance).to.be.lt(deployerInitialBalance)
            expect(vaultFinalBalance).to.be.gt(vaultInitialBalance)
            expect(deployerShares).to.be.gt(depositAmount)
        })
    })

    describe("Administrative methods", function () {
        describe("Cap", function () {
            before(async function () {
                await busd.connect(thirdAct).approve(alphaVault.address, depositAmount.mul(10))
            })

            it("Should not be able to deposit more than cap", async function () {
                const tx = alphaVault.connect(thirdAct).deposit(depositAmount.mul(10))
                await expect(tx).to.be.revertedWith("Cap reached")
            })

            it("Should not be able to change cap if not owner", async function () {
                const tx = alphaVault.connect(thirdAct).setCap(depositAmount.mul(100))
                await expect(tx).to.be.revertedWith("Ownable: caller is not the owner")
            })

            it("Should be able to change cap if owner", async function () {
                const tx = alphaVault.connect(deployer).setCap(depositAmount.mul(100))
                await expect(tx).not.to.be.reverted
            })

            it("Should be able to deposit with new cap", async function () {
                const tx = alphaVault.connect(thirdAct).deposit(depositAmount.mul(10))
                await expect(tx).not.to.be.reverted
            })
        })

        describe("Start / Stop", async function () {
            it("Should not be possible to start if not owner", async function () {
                const tx = alphaVault.connect(thirdAct).start()
                await expect(tx).to.be.revertedWith("Ownable: caller is not the owner")
            })

            it("Should not be possible to stopTrading if not owner", async function () {
                const tx = alphaVault.connect(thirdAct).stopTrading(BigNumber.from("0"))
                await expect(tx).to.be.revertedWith("Ownable: caller is not the owner")
            })

            it("Should not be possible to stop if not owner", async function () {
                const tx = alphaVault.connect(thirdAct).stop()
                await expect(tx).to.be.revertedWith("Ownable: caller is not the owner")
            })
        })

        describe("Harvest", async function () {
            it("Should not be possible to call harvest when epoch is not running", async function () {
                const tx = alphaVault.harvest(false)
                await expect(tx).to.be.revertedWith("No funds in lending");
            })
        })
    })
});
