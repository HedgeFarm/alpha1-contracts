// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "./interface/alphavault/IAlphaVault.sol";

/// @title AlphaVaultMigratooor
/// @author HedgeFarm
/// @notice A simple contract to migrate funds from one AlphaVault to another,
contract AlphaVaultMigratooor is OwnableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @notice The base token of both vaults.
    address public token;
    /// @notice The vault to withdraw from.
    address public oldVault;
    /// @notice The vault to deposit into.
    address public newVault;

    /// @notice Creates a new migrator.
    /// @param _token The base token of both vaults.
    /// @param _oldVault The vault to withdraw from.
    /// @param _newVault The vault to deposit into.
    function initialize(address _token, address _oldVault, address _newVault) external initializer {
        __Ownable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        token = _token;
        oldVault = _oldVault;
        newVault = _newVault;
    }

    /// @notice Function called by {upgradeTo} and {upgradeToAndCall} to upgrade implementation.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @notice Returns the current implementation address.
    /// @return The address of the implementation.
    function getImplementation() external view returns (address) {
        return _getImplementation();
    }

    /// @notice Migrates funds from the old vault to the new one.
    function migrate() external nonReentrant {
        // TransferFrom IOU balance of v1
        IERC20Upgradeable(oldVault).safeTransferFrom(msg.sender, address(this), IERC20Upgradeable(oldVault).balanceOf(msg.sender));

        // Withdraw from v1
        IAlphaVault(oldVault).withdraw(IERC20Upgradeable(oldVault).balanceOf(address(this)));

        // Deposit in v2
        IERC20Upgradeable(token).safeApprove(newVault, IERC20Upgradeable(token).balanceOf(address(this)));
        IAlphaVault(newVault).deposit(IERC20Upgradeable(token).balanceOf(address(this)));

        // Transfer IOU balance of v2
        IERC20Upgradeable(newVault).safeTransfer(msg.sender, IERC20Upgradeable(newVault).balanceOf(address(this)));
    }
}