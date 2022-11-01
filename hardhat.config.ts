import { HardhatUserConfig } from "hardhat/config";
import "@openzeppelin/hardhat-upgrades";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-contract-sizer";
import "solidity-coverage";
import dotenv from "dotenv";
import path from "path";
dotenv.config();

const tasksPath = path.join(__dirname, "tasks");
require(`${tasksPath}/deploy-AlphaVault.ts`);
require(`${tasksPath}/deploy-ECDSA.ts`);
require(`${tasksPath}/deploy-GMXPositionManager.ts`);
require(`${tasksPath}/deploy-GMXPositionManagerDelegator.ts`);
require(`${tasksPath}/upgrade-GMXPositionManagerDelegator.ts`);

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      forking: {
        url: "https://api.avax.network/ext/bc/C/rpc",
      },
    },
    bsctestnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545/",
      accounts: [process.env.HEDGEFARM_KEY || ""],
    },
    bsc: {
      url: "https://bsc-dataseed.binance.org/",
      accounts: [process.env.HEDGEFARM_KEY || ""],
    },
    avax: {
      url: "https://api.avax.network/ext/bc/C/rpc",
      accounts: [process.env.HEDGEFARM_KEY || ""],
    },
  },
  solidity: {
    version: "0.8.9",
    settings: {
      optimizer: {
        enabled: true,
        runs: 100,
      },
    },
  },
  etherscan: {
    apiKey: process.env.SNOWTRACE_KEY || "",
  },
};

export default config;
