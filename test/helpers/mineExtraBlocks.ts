const { ethers } = require("hardhat");

export async function mineExtraBlocks(nbOfBlocksToMine: number) {
  // We get the contract to deploy
  for (let i = 0; i < nbOfBlocksToMine; i++) {
    await ethers.provider.send("evm_mine");
  }
}
