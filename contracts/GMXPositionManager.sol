// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./interface/gmx/IGMXRouter.sol";
import "./interface/gmx/IGMXPositionRouter.sol";
import "./interface/gmx/IGMXVault.sol";

/// @title GMXPositionManager
/// @author HedgeFarm
/// @notice A GMX position manager for HedgeFarm's AlphaVault.
contract GMXPositionManager {
    /// @notice The token that can be deposited or withdrawn in the vault.
    address public token;
    /// @notice The AlphaVault address.
    address public vault;
    /// @notice GMX vault.
    address public gmxVault = address(0x9ab2De34A33fB459b538c43f251eB825645e8595);
    /// @notice The router of GMX to approve plugins.
    address public gmxRouter = address(0x5F719c2F1095F7B9fc68a68e35B51194f4b6abe8);
    /// @notice The router of GMX to interact with positions.
    address public gmxPositionRouter = address(0x195256074192170d1530527abC9943759c7167d8);
    /// @notice Chainlink oracle address for {token}/USD
    mapping(address => address) public oracles;

    modifier onlyVault {
        require(msg.sender == vault, "Not vault");
        _;
    }

    /// @notice Creates a new GMXPositionManager.
    /// @param _token The token that can be deposited or withdrawn in the vault.
    /// @param _vault The address of the AlphaVault.
    constructor(address _token, address _vault) {
        token = _token;
        vault = _vault;

        IGMXRouter(gmxRouter).approvePlugin(gmxPositionRouter);

        // WAVAX
        oracles[0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7] = 0x0A77230d17318075983913bC2145DB16C7366156;
        // WETH.e
        oracles[0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB] = 0x976B3D034E162d8bD72D6b9C989d545b839003b0;
        // WBTC.e
        oracles[0x50b7545627a5162F82A992c33b87aDc75187B218] = 0x2779D32d5166BAaa2B2b658333bA7e6Ec0C65743;
        // BTC.B
        oracles[0x152b9d0FdC40C096757F570A51E494bd4b943E50] = 0x2779D32d5166BAaa2B2b658333bA7e6Ec0C65743;
    }

    /// @notice Opens a GMX position for a token.
    /// @param indexToken The address of the token that is longed or shorted.
    /// @param tokenAmount The amount in vault {token} to use as collateral.
    /// @param isLong If we long or if we short.
    function openPosition(address indexToken, uint256 tokenAmount, bool isLong) external payable onlyVault {
        IERC20(token).transferFrom(vault, address(this), tokenAmount);
        IERC20(token).approve(gmxRouter, tokenAmount);

        (,int price,,,) = AggregatorV3Interface(oracles[indexToken]).latestRoundData();
        uint256 positionSize = tokenAmount * 110 / 100 * 1e24; // 1.1x leverage (1e12 for normalization + 1e12 for GMX precision)

        uint256 acceptablePrice = 0;
        if (isLong) {
            address[] memory path = new address[](2);
            path[0] = token;
            path[1] = indexToken;
            acceptablePrice = uint256(price) * 10030 / 10000 * 1e22; // GMX uses 30 bps tolerance

            IGMXPositionRouter(gmxPositionRouter).createIncreasePosition{value: msg.value}(path, indexToken, tokenAmount, 0, positionSize, isLong, acceptablePrice, 20000000000000000, 0x0);
        } else {
            address[] memory path = new address[](1);
            path[0] = token;
            acceptablePrice = uint256(price) * 9970 / 10000 * 1e22; // GMX uses 30 bps tolerance

            IGMXPositionRouter(gmxPositionRouter).createIncreasePosition{value: msg.value}(path, indexToken, tokenAmount, 0, positionSize, isLong, acceptablePrice, 20000000000000000, 0x0);
        }
    }

    /// @notice Closes the GMX position for a token.
    /// @param indexToken The address of the token that is longed or shorted.
    /// @param isLong If we long or if we short.
    function closePosition(address indexToken, bool isLong) external payable onlyVault {
        (,int price,,,) = AggregatorV3Interface(oracles[indexToken]).latestRoundData();
        uint256 acceptablePrice = 0;

        if (isLong) {
            (uint256 sizeDelta,,,,,,,) = IGMXVault(gmxVault).getPosition(address(this), indexToken, indexToken, isLong);
            address[] memory path = new address[](2);
            path[0] = indexToken;
            path[1] = token;
            acceptablePrice = uint256(price) * 9970 / 10000 * 1e22; // GMX uses 30 bps tolerance

            IGMXPositionRouter(gmxPositionRouter).createDecreasePosition{value: msg.value}(path, indexToken, 0, sizeDelta, isLong, vault, acceptablePrice, 0, 20000000000000000, false);
        } else {
            (uint256 sizeDelta,,,,,,,) = IGMXVault(gmxVault).getPosition(address(this), token, indexToken, isLong);
            address[] memory path = new address[](1);
            path[0] = token;
            acceptablePrice = uint256(price) * 10030 / 10000 * 1e22; // GMX uses 30 bps tolerance

            IGMXPositionRouter(gmxPositionRouter).createDecreasePosition{value: msg.value}(path, indexToken, 0, sizeDelta, isLong, vault, acceptablePrice, 0, 20000000000000000, false);
        }
    }
}