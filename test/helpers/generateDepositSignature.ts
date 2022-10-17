import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export async function generateDepositSignature(signer: SignerWithAddress, depositor: SignerWithAddress) {
  const hash = ethers.utils.keccak256(ethers.utils.arrayify(depositor.address));

  // When signing the message it adds the "Ethereum Signed Message" necessary prefixes
  return await signer.signMessage(ethers.utils.arrayify(hash));
}
