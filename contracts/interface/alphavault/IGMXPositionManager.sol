// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IGMXPositionManager {
    function openPosition(address indexToken, uint256 tokenAmount, bool isLong) external payable;
    function closePosition(address indexToken, bool isLong) external payable;
}