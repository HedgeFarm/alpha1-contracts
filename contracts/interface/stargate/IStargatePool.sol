// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IStargatePool {
    function amountLPtoLD(uint256 _amountLP) external view returns (uint256);
    function deltaCredit() external view returns (uint256);
    function totalLiquidity() external view returns (uint256);
    function totalSupply() external view returns (uint256);
}