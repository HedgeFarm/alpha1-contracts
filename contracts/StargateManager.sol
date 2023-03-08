// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "./interface/stargate/IStargateRouter.sol";
import "./interface/stargate/IStargateLpStaking.sol";
import "./interface/stargate/IStargatePool.sol";
import "./interface/traderjoe/IJoeRouter02.sol";

/// @title StargateManager
/// @author HedgeFarm
/// @notice Manages Stargate positions for HedgeFarm's AlphaVault.
contract StargateManager is OwnableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    /// @notice The token that can be deposited or withdrawn in the vault.
    address public token;
    /// @notice The AlphaVault address.
    address public vault;
    /// @notice The manager can only send back funds to the vault.
    address public manager;
    // @notice The swap router.
    address public swapRouter;

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

    /// @notice Checks the sender is the vault.
    modifier onlyVault {
        require(msg.sender == vault, "Not vault");
        _;
    }

    /// @notice Checks the sender is the vault or the manager.
    modifier onlyVaultOrManager {
        require(msg.sender == vault || msg.sender == manager, "Not allowed");
        _;
    }

    /// @notice This event is triggered when we change the token.
    /// @param newToken The address of the new token.
    event TokenChanged(address indexed newToken);

    /// @notice This event is triggered when we change the vault.
    /// @param newVault The address of the new vault.
    event VaultChanged(address indexed newVault);

    /// @notice This event is triggered when we change the manager.
    /// @param newManager The address of the new manager.
    event ManagerChanged(address indexed newManager);

    /// @notice This event is triggered when we change the swap router.
    /// @param newSwapRouter The address of the new manager.
    event SwapRouterChanged(address indexed newSwapRouter);

    /// @notice This event is triggered when we change the Stargate parameters.
    event StargateParametersChanged();

    /// @notice Creates a new StargateManager.
    /// @param _token The token that can be deposited or withdrawn in the vault.
    /// @param _vault The address of the AlphaVault.
    /// @param _manager The address of the manager.
    /// @param _swapRouter The router to swap the rewards.
    /// @param _stargateLpToken The contract of the Stargate LP token.
    /// @param _stargateRouter The contract of the Stargate Router.
    /// @param _stargateRouterPoolId The pool ID of the token for the Stargate router.
    /// @param _stargateLpStaking The contract to stake the Stargate LP token.
    /// @param _stargateLpStakingPoolId The pool ID of the token for Stargate staking.
    /// @param _stgToken The address of the STG token.
    function initialize(address _token, address _vault, address _manager, address _swapRouter, address _stargateLpToken, address _stargateRouter, uint16 _stargateRouterPoolId, address _stargateLpStaking, uint16 _stargateLpStakingPoolId, address _stgToken) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();

        token = _token;
        vault = _vault;
        manager = _manager;
        swapRouter = _swapRouter;

        stargateLpToken = _stargateLpToken;
        stargateRouter = IStargateRouter(_stargateRouter);
        stargateRouterPoolId = _stargateRouterPoolId;
        stargateLpStaking = IStargateLpStaking(_stargateLpStaking);
        stargateLpStakingPoolId = _stargateLpStakingPoolId;
        stgToken = _stgToken;
        rewards = [stgToken];
        withdrawRemoteChainId = 110;
    }

    /// @notice Function called by {upgradeTo} and {upgradeToAndCall} to upgrade implementation.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    ///
    /// @notice Returns the current implementation address.
    /// @return The address of the implementation.
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
    function withdraw() external payable onlyVault returns (bool) {
        if (isSyncWithdrawalPossible()) {
            _stargateSyncRedeem();
            return true;
        } else {
            _stargateAsyncRedeem();
            return false;
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
            payable(owner()), // refund extra native gas to owners
            totalLpTokens, // the amount of LP to withdraw
            abi.encodePacked(address(this)), // receiver
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
        require(_token != address(0), "Address can't be 0");
        token = _token;
        emit TokenChanged(_token);
    }

    /// @notice Updates the vault.
    /// @param _vault The address of the vault.
    function setVault(address _vault) external onlyOwner {
        require(_vault != address(0), "Address can't be 0");
        vault = _vault;
        emit VaultChanged(_vault);
    }

    /// @notice Sets a new manager.
    /// @param _manager The address of the new manager.
    function setManager(address _manager) external onlyOwner {
        require(_manager != address(0), "Address can't be 0");
        manager = _manager;
        emit ManagerChanged(_manager);
    }

    /// @notice Updates the swap router.
    /// @param _swapRouter The address of the swap router.
    function setSwapRouter(address _swapRouter) external onlyOwner {
        require(_swapRouter != address(0), "Address can't be 0");
        swapRouter = _swapRouter;
        emit SwapRouterChanged(_swapRouter);
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
        emit StargateParametersChanged();
    }

    /// @notice Helper function to recover tokens on this contract, for example in case of Stargate async withdrawal. They will be sent back to the vault.
    function withdrawToken() external onlyVaultOrManager returns (uint256) {
        uint256 balance = IERC20Upgradeable(token).balanceOf(address(this));
        IERC20Upgradeable(token).safeTransfer(vault, balance);
        return balance;
    }

    /// @notice Helper function in case random tokens are sent to the contract. Doesn't work for {token}.
    /// @param _rescueToken The address of the stuck token.
    /// @param _recipient The address of the recipient of the stuck token.
    function rescue(address _rescueToken, address _recipient) external onlyOwner {
        require(_rescueToken != token, "No rug");
        require(_rescueToken != stargateLpToken, "No rug");
        IERC20Upgradeable(_rescueToken).safeTransfer(_recipient, IERC20Upgradeable(_rescueToken).balanceOf(address(this)));
    }
}