// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IYieldManager {
    function deposit(uint256 _amount) external;
    function harvest(bool _autocompound) external;
    function withdraw() external payable returns (bool);
    function withdrawToken() external returns (uint256);
}