// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

/// @title GMXPositionManagerDelegator
/// @author HedgeFarm
/// @notice A GMX position manager delegator for HedgeFarm's AlphaVault.
contract GMXPositionManagerDelegatorV2 is OwnableUpgradeable, UUPSUpgradeable {
    /// @notice The token that can be deposited or withdrawn in the vault.
    address public token;
    /// @notice The AlphaVault address.
    address public vault;
    /// @notice The managers safe.
    address public manager;
    /// @notice Test constant.
    uint256 public constant answer = 42;

    modifier onlyVault {
        require(msg.sender == vault, "Not vault");
        _;
    }

    /// @notice Creates a new GMXPositionManagerDelegator.
    /// @param _token The token that can be deposited or withdrawn in the vault.
    /// @param _vault The address of the AlphaVault.
    /// @param _manager The address of the manager.
    function initialize(address _token, address _vault, address _manager) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();

        token = _token;
        vault = _vault;
        manager = _manager;
    }

    function initializeV2() external reinitializer(2) onlyOwner {
        token = address(0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function getImplementation() external view returns (address) {
        return _getImplementation();
    }

    /// @notice Simulates a position opening on GMX.
    /// @param indexToken The address of the token that is longed or shorted.
    /// @param tokenAmount The amount in vault {token} to use as collateral.
    /// @param isLong If we long or if we short.
    function openPosition(address indexToken, uint256 tokenAmount, bool isLong) external payable onlyVault {
        IERC20Upgradeable(token).transferFrom(vault, address(this), tokenAmount);
    }

    /// @notice Simulates a position closing on GMX.
    /// @param indexToken The address of the token that is longed or shorted.
    /// @param isLong If we long or if we short.
    function closePosition(address indexToken, bool isLong) external payable onlyVault {}

    /// @notice In case some funds are transferred on this contract, this method will send them back to the vault.
    function withdrawFunds(address _token) external onlyOwner {
        IERC20Upgradeable(_token).transfer(manager, IERC20Upgradeable(token).balanceOf(address(this)));
    }

    /// @notice In case some AVAX is transferred on the contract, this method will it to the manager.
    function withdrawNative() external onlyOwner {
        payable(manager).transfer(address(this).balance);
    }

    /// @notice Sets a new vault.
    /// @param _vault The address of the new vault.
    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "Address == 0");
        vault = _vault;
    }

    /// @notice Sets a new token.
    /// @param _token The address of the new token.
    function setToken(address _token) external onlyOwner {
        require(_token != address(0), "Address == 0");
        token = _token;
    }

    /// @notice Sets a new manager.
    /// @param _manager The address of the new manager.
    function setManager(address _manager) external onlyOwner {
        require(_manager != address(0), "Address == 0");
        manager = _manager;
    }

    receive() external payable {}
}