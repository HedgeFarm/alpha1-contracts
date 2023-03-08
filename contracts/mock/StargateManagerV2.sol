// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "./../interface/stargate/IStargateRouter.sol";
import "./../interface/stargate/IStargateLpStaking.sol";
import "./../interface/stargate/IStargatePool.sol";
import "./../interface/traderjoe/IJoeRouter02.sol";

/// @title StargateManager
/// @author HedgeFarm
/// @notice Manages Stargate positions for HedgeFarm's AlphaVault.
contract StargateManagerV2 is OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    /// @notice The token that can be deposited or withdrawn in the vault.
    address public token;
    /// @notice The AlphaVault address.
    address public vault;
    /// @notice The manager can only send back funds to the vault.
    address public manager;
    // @notice The swap router.
    address public swapRouter; // TraderJoe

    /// @notice The address of the S* token.
    address public stargateLpToken;
    /// @notice The address of the router to get the LP token.
    IStargateRouter public stargateRouter;
    /// @notice The id of the router pool for the {token} to deposit.
    uint16 public stargateRouterPoolId;
    /// @notice The address of the staking pool to get the rewards.
    IStargateLpStaking public stargateLpStaking;
    /// @notice The id of the staking pool for the {token} to deposit.
    uint16 public stargateLpStakingPoolId;
    /// @notice The address of the Stargate token.
    address public stgToken;
    /// @notice The Stargate rewards to harvest.
    address[] public rewards;
    /// @notice The default chain id to redeem async.
    uint16 public withdrawRemoteChainId;

    /// @notice Test constant.
    uint256 public constant answer = 42;

    /// @notice Checks the sender is the vault.
    modifier onlyVault {
        require(msg.sender == vault, "Not vault");
        _;
    }

    /// @notice Creates a new StargateManager.
    /// @param _token The token that can be deposited or withdrawn in the vault.
    /// @param _vault The address of the AlphaVault.
    function initialize(address _token, address _vault, address _swapRouter, address _stargateLpToken, address _stargateRouter, uint16 _stargateRouterPoolId, address _stargateLpStaking, uint16 _stargateLpStakingPoolId, address _stgToken) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();

        token = _token;
        vault = _vault;
        swapRouter = address(0x60aE616a2155Ee3d9A68541Ba4544862310933d4); // Trader Joe

        stargateLpToken = _stargateLpToken;
        stargateRouter = IStargateRouter(_stargateRouter);
        stargateRouterPoolId = _stargateRouterPoolId;
        stargateLpStaking = IStargateLpStaking(_stargateLpStaking);
        stargateLpStakingPoolId = _stargateLpStakingPoolId;
        stgToken = _stgToken;
        rewards = [stgToken];
        withdrawRemoteChainId = 110;
    }

    function initializeV2() external reinitializer(2) onlyOwner {
        withdrawRemoteChainId = 210;
    }

    /// @notice Function called by {upgradeTo} and {upgradeToAndCall} to upgrade implementation.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    ///
    /// @notice Returns the current implementation address.
    /// @return The address of the implementation.
    ///
    function getImplementation() external view returns (address) {
        return _getImplementation();
    }

    /// @notice Deposits funds into Stargate and stakes them.
    /// @param _amount The amount of {token} to deposit.
    function deposit(uint256 _amount) external onlyVault {
        IERC20Upgradeable(token).safeTransferFrom(vault, address(this), _amount);
        _stargateDeposit(_amount);
    }

    /// @notice Withdraws all the funds from Stargate.
    function withdraw() external payable onlyVault {
        harvest(false);

        if (isSyncWithdrawalPossible()) {
            _stargateSyncRedeem();
        } else {
            _stargateAsyncRedeem();
        }
    }

    /// @notice Harvests the rewards from Stargate LP staking and swaps them for {token}.
    /// @param _autocompound Boolean to indicate whether to redeposit the {token} in Stargate.
    function harvest(bool _autocompound) public onlyVault {
        // Putting 0 will harvest
        stargateLpStaking.deposit(stargateLpStakingPoolId, 0);

        for (uint8 i = 0; i < rewards.length; i++) {
            address rewardToken = rewards[i];
            uint256 tokenBalance = IERC20Upgradeable(rewardToken).balanceOf(address(this));

            address[] memory path = new address[](3);
            path[0] = rewardToken;
            path[1] = IJoeRouter02(swapRouter).WAVAX();
            path[2] = token;

            uint256[] memory amountsOut = IJoeRouter02(swapRouter).getAmountsOut(tokenBalance, path);
            if (amountsOut[2] > 0) {
                // Swap will not revert for lack of liquidity or amount too small
                IERC20Upgradeable(rewardToken).safeApprove(swapRouter, tokenBalance);

                // solhint-disable-next-line not-rely-on-time
                IJoeRouter02(swapRouter).swapExactTokensForTokens(tokenBalance, 0, path, address(this), block.timestamp + 10);
            }
        }

        if (_autocompound) {
            _stargateDeposit(IERC20Upgradeable(token).balanceOf(address(this)));
        }
    }

    /// @notice Deposits and stakes funds in Stargate.
    /// @param amount The amount of {token} to deposit.
    function _stargateDeposit(uint256 amount) internal {
        IERC20Upgradeable(token).safeApprove(address(stargateRouter), amount);
        stargateRouter.addLiquidity(stargateRouterPoolId, amount, address(this));
        uint256 receivedLpToken = IERC20Upgradeable(stargateLpToken).balanceOf(address(this));
        IERC20Upgradeable(stargateLpToken).safeApprove(address(stargateLpStaking), receivedLpToken);
        stargateLpStaking.deposit(stargateLpStakingPoolId, receivedLpToken);
    }

    /// @notice Returns the LP balance staked in Stargate.
    /// @return The LP amount staked.
    function _getStargateLpBalance() internal view returns (uint256) {
        (uint256 amount,) = stargateLpStaking.userInfo(stargateLpStakingPoolId, address(this));
        return amount;
    }

    /// @notice Does an instant redeem from Stargate and closes the epoch.
    function _stargateSyncRedeem() internal {
        require(msg.value == 0, "Redeem requires no funds");

        uint256 totalLpTokens = _getStargateLpBalance();
        stargateLpStaking.withdraw(stargateLpStakingPoolId, totalLpTokens);
        stargateRouter.instantRedeemLocal(stargateRouterPoolId, totalLpTokens, address(this));

        IERC20Upgradeable(token).safeTransfer(vault, IERC20Upgradeable(token).balanceOf(address(this)));
    }

    /// @notice Does an async redeem from Stargate.
    function _stargateAsyncRedeem() internal {
        require(msg.value >= 0.3 * 10 ** 18, "RedeemLocal requires funds");

        uint256 totalLpTokens = _getStargateLpBalance();
        stargateLpStaking.withdraw(stargateLpStakingPoolId, totalLpTokens);

        IStargateRouter.lzTxObj memory lzTxObj = IStargateRouter.lzTxObj(0, 0, "0x");
        stargateRouter.redeemLocal{value: msg.value}(
            withdrawRemoteChainId,
            stargateRouterPoolId, // source pool
            stargateRouterPoolId, // destination pool
            payable(address(msg.sender)), // refund extra native gas to this address
            totalLpTokens, // the amount of LP to withdraw
            abi.encodePacked(address(vault)), // receiver
            lzTxObj
        );

        // Transfer harvest balance to vault
        IERC20Upgradeable(token).safeTransfer(vault, IERC20Upgradeable(token).balanceOf(address(this)));
    }

    /// @notice Stargate helper querying delta credits to determine if an instant withdrawal is possible.
    /// @return True if an instant withdrawal is available for our LP count.
    function isSyncWithdrawalPossible() public view returns (bool) {
        uint256 deltaCredit = IStargatePool(stargateLpToken).deltaCredit();
        uint256 deltaCreditInLP = _amountSDtoLP(deltaCredit);
        return deltaCreditInLP >= _getStargateLpBalance();
    }

    /// @notice Conversion helper from Stargate.
    /// @param amountSD An amount of liquidity.
    /// @return A LP amount.
    function _amountSDtoLP(uint256 amountSD) internal view returns (uint256) {
        return amountSD * IStargatePool(stargateLpToken).totalSupply() / IStargatePool(stargateLpToken).totalLiquidity();
    }

    /// @notice Updates the vault token.
    /// @param _token The address of the new token.
    function setToken(address _token) external onlyOwner {
        token = _token;
    }

    /// @notice Updates the vault.
    /// @param _vault The address of the vault.
    function setVault(address _vault) external onlyOwner {
        vault = _vault;
    }

    /// @notice Updates the swap router.
    /// @param _swapRouter The address of the swap router.
    function setSwapRouter(address _swapRouter) external onlyOwner {
        swapRouter = _swapRouter;
    }

    /// @notice Updates the Stargate addresses and parameters.
    /// @param _stargateLpToken The address of the Stargate S*{token} LP.
    /// @param _stargateRouter The address of the Stargate Router.
    /// @param _stargateRouterPoolId The id of the pool on the router for {token}.
    /// @param _stargateLpStaking The address of Stargate staking contract.
    /// @param _stargateLpStakingPoolId The id of the staking pool for {token}.
    /// @param _stgToken The address of the Stargate token.
    /// @param _rewards The rewards distributed by Stargate on staking.
    /// @param _withdrawRemoteChainId The chain id where to request funds when withdrawing remotely.
    function setStargateParameters(address _stargateLpToken, address _stargateRouter, uint16 _stargateRouterPoolId, address _stargateLpStaking, uint16 _stargateLpStakingPoolId, address _stgToken, address[] memory _rewards, uint16 _withdrawRemoteChainId) external onlyOwner {
        stargateLpToken = _stargateLpToken;
        stargateRouter = IStargateRouter(_stargateRouter);
        stargateRouterPoolId = _stargateRouterPoolId;
        stargateLpStaking = IStargateLpStaking(_stargateLpStaking);
        stargateLpStakingPoolId = _stargateLpStakingPoolId;
        stgToken = _stgToken;
        rewards = _rewards;
        withdrawRemoteChainId = _withdrawRemoteChainId;
    }

    /// @notice Helper function in case some {token} are stuck on this contract. They will be sent back to the vault.
    function withdrawToken() external onlyOwner {
        IERC20Upgradeable(token).safeTransfer(vault, IERC20Upgradeable(token).balanceOf(address(this)));
    }

    /// @notice Helper function in case random tokens are sent to the contract. Doesn't work for {token}.
    /// @param _rescueToken The address of the stuck token.
    /// @param _recipient The address of the recipient of the stuck token.
    function rescue(address _rescueToken, address _recipient) external onlyOwner {
        require(_rescueToken != token, "No rug");
        IERC20Upgradeable(_rescueToken).safeTransfer(_recipient, IERC20Upgradeable(_rescueToken).balanceOf(address(this)));
    }
}