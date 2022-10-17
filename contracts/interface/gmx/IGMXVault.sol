// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IGMXVault {
    function getPosition(address _account, address _collateralToken, address _indexToken, bool _isLong) external returns (uint256 size, uint256 collateral, uint256 averagePrice, uint256 entryFundingRate, uint256 reserveAmount, uint256 realisedPnl, bool realisedPnLPositive, uint256 lastIncreasedTime);
}