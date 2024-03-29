// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IAlphaVault {
    function deposit(uint256 _amount) external;
    function withdraw(uint256 _shares) external;
}