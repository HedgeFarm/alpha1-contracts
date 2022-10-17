import { ethers } from "hardhat";
import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export async function unlockAddress(address: string): Promise<SignerWithAddress> {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [address],
  });
  return await ethers.getSigner(address);
}
