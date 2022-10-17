// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IStargateLpStaking {
    function pendingStargate(uint256 pid, address user) external view returns (uint256);
    function deposit(uint256 pid, uint256 amount) external;
    function withdraw(uint256 pid, uint256 amount) external;
    function userInfo(uint256 pid, address user) external view returns (uint256, uint256);
    function poolInfo(uint256 poolId) external view returns(address, uint256, uint256, uint256);
}