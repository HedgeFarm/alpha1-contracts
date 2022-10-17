// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interface/pancakeswap/IPancakeSwapRouterV2.sol";
import "./interface/stargate/IStargateRouter.sol";
import "./interface/stargate/IStargateLpStaking.sol";
import "./interface/stargate/IStargatePool.sol";

/// @title AlphaVaultBSC
/// @author HedgeFarm
/// @notice A vault with simple epoch gestion for the alpha strategies of HedgeFarm made for the Binance Chain.
contract AlphaVaultBSC is ERC20, Ownable {

    /// @notice The token that can be deposited or withdrawn.
    address public token;
    /// @notice The trading manager will get 20% of the funds for longing/shorting assets.
    address public tradingManager;
    // @notice The swap router of PancakeSwap
    address public swapRouter = address(0x10ED43C718714eb63d5aA57B78B54704E256024E);
    /// @notice Boolean to indicate if the strategy is running and has allocated funds in a lending protocol.
    bool public isEpochRunning;
    /// @notice Boolean to indicate if the strategy has some funds in the trading manager for longs/shorts.
    bool public isTrading;
    /// @notice The maximum total balance cap for the strategy.
    uint256 public cap;

    /// @notice When funds are allocated, stores the last relevant price per IOU.
    uint256 public lastPricePerShare;
    /// @notice When funds are allocated, stores the last relevant total balance.
    uint256 public lastTotalBalance;

    /// @notice Percentage of funds moved to Farm
    uint256 public constant SHARE_FOR_FARM = 80;
    /// @notice Percentage
    uint256 public constant PERCENT = 100;

    /// @notice Stargate lending addresses.
    IStargateLpStaking public stargateLpStaking;
    IStargateRouter public stargateRouter = IStargateRouter(0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8);
    address public stargateLpToken;
    address public stgToken = address(0xB0D502E938ed5f4df2E681fE6E419ff29631d62b);
    uint8 public stargateRouterPoolId;
    uint8 public stargateLpStakingPoolId;

    /// @notice This event is triggered when a deposit is completed.
    /// @param from The address depositing funds.
    /// @param amount The amount in {token} deposited.
    event Deposit(address indexed from, uint256 amount);

    /// @notice This event is triggered when a withdraw is completed.
    /// @param to The address withdrawing funds.
    /// @param amount The amount in {token} withdrawn.
    event Withdraw(address indexed to, uint256 amount);

    /// @notice This event is triggered when we start an epoch.
    /// @param totalAmount The amount to be allocated in lending and trading.
    event Start(uint256 totalAmount);

    /// @notice This event is triggered when we stop an epoch.
    /// @param totalAmount The amount from the lending, trading and rewards.
    event Stop(uint256 totalAmount);

    /// @notice Creates a new vault with a {token} that can be lent in Stargate.
    /// @param _name The name of the vault token.
    /// @param _symbol The symbol of the vault token.
    /// @param _tradingManager The address of the wallet which will receive the 20% of funds for longs/shorts.
    /// @param _cap The maximum total balance cap of the vault.
    /// @param _stargateLpStaking The contract to stake the Stargate LP token.
    /// @param _stargateLpToken The contract of the Stargate LP token.
    /// @param _stargateRouterPoolId The pool ID of the token for the Stargate router.
    /// @param _stargateLpStakingPoolId The pool ID of the token for Stargate staking.
    constructor(
        string memory _name,
        string memory _symbol,
        address _token,
        address _tradingManager,
        uint256 _cap,
        address _stargateLpStaking,
        address _stargateLpToken,
        uint8 _stargateRouterPoolId,
        uint8 _stargateLpStakingPoolId
    ) ERC20(_name, _symbol) {
        token = _token;
        tradingManager = _tradingManager;
        cap = _cap;
        stargateLpStaking = IStargateLpStaking(_stargateLpStaking);
        stargateLpToken = _stargateLpToken;
        stargateRouterPoolId = _stargateRouterPoolId;
        stargateLpStakingPoolId = _stargateLpStakingPoolId;
        isEpochRunning = false;
        isTrading = false;
    }

    /// @notice Deposit an amount in the contract.
    /// @param _amount The amount of {want} to deposit.
    function deposit(uint256 _amount) external {
        require(!isEpochRunning, "Disabled when during epoch");
        require(_amount + totalBalance() <= cap, "Cap reached");

        uint256 pool = totalBalance();
        IERC20(token).transferFrom(msg.sender, address(this), _amount);

        uint256 shares = 0;
        if (totalSupply() == 0) {
            shares = _amount;
        } else {
            shares = _amount * totalSupply() / pool;
        }

        _mint(msg.sender, shares);

        emit Deposit(msg.sender, _amount);
    }

    /// @notice Withdraws all the shares of the user.
    function withdrawAll() external {
        withdraw(balanceOf(msg.sender));
    }

    /// @notice Withdraws the amount of {token} represented by the user's shares.
    /// @param _shares The amount of shares to withdraw.
    function withdraw(uint256 _shares) public {
        require(!isEpochRunning, "Disabled when during epoch");
        require(_shares <= balanceOf(msg.sender), "Not enough shares");

        uint256 returnAmount = totalBalance() * _shares / totalSupply();

        _burn(msg.sender, _shares);

        IERC20(token).transfer(msg.sender, returnAmount);

        emit Withdraw(msg.sender, returnAmount);
    }

    /// @notice Starts an epoch and allocates the funds to the lending platform and the trading manager.
    /// It blocks the deposits and withdrawals.
    function start() external onlyOwner {
        lastTotalBalance = totalBalance();
        lastPricePerShare = pricePerShare();

        uint256 lendingAmount = IERC20(token).balanceOf(address(this)) * SHARE_FOR_FARM / PERCENT;

        _stargateDeposit(lendingAmount);

        // Send rest of funds (20%) to trading manager
        IERC20(token).transfer(tradingManager, IERC20(token).balanceOf(address(this)));

        isEpochRunning = true;
        isTrading = true;

        emit Start(lastTotalBalance);
    }

    /// @notice Withdraws funds from the trading manager.
    /// @param amount The amount of {token} to withdraw.
    function stopTrading(uint256 amount) external onlyOwner {
        IERC20(token).transferFrom(tradingManager, address(this), amount);
        isTrading = false;
    }

    /// @notice Stops the epoch, withdraws funds from farm, unlocks deposits and withdrawals.
    function stop() external onlyOwner {
        require(!isTrading, "Return first trading funds");

        harvest(false);

        uint256 totalLpTokens = _getStargateLpBalance();
        stargateLpStaking.withdraw(stargateLpStakingPoolId, totalLpTokens);
        stargateRouter.instantRedeemLocal(stargateRouterPoolId, totalLpTokens, address(this));

        isEpochRunning = false;

        emit Stop(IERC20(token).balanceOf(address(this)));
    }

    /// @notice Harvests and sells the rewards of the lending farm.
    /// @param autocompound Boolean to indicate if it should auto-compound the rewards.
    function harvest(bool autocompound) public {
        require(isEpochRunning, "No funds in lending");

        // Putting 0 will harvest
        stargateLpStaking.deposit(stargateLpStakingPoolId, 0);

        uint256 stgBalance = IERC20(stgToken).balanceOf(address(this));
        IERC20(stgToken).approve(swapRouter, stgBalance);

        address[] memory path = new address[](3);
        path[0] = stgToken;
        path[1] = IPancakeSwapRouterV2(swapRouter).WETH();
        path[2] = token;
        IPancakeSwapRouterV2(swapRouter).swapExactTokensForTokens(stgBalance, 0, path, address(this), block.timestamp + 10);

        if (autocompound) {
            _stargateDeposit(IERC20(token).balanceOf(address(this)));
        }
    }

    /// @notice Returns the total balance of {token} in strategy. When funds are allocated, it returns the last relevant balance.
    /// @return The total balance amount in {token}.
    function totalBalance() public view returns (uint256) {
        if (isEpochRunning) {
            return lastTotalBalance;
        } else {
            return IERC20(token).balanceOf(address(this));
        }
    }

    /// @notice Returns the price of a single share. When funds are allocated, it returns the last relevant price.
    /// @return The price of a single share.
    function pricePerShare() public view returns (uint256) {
        if (isEpochRunning) {
            return lastPricePerShare;
        } else {
            return totalSupply() == 0 ? 1e18 : totalBalance() * 1e18 / totalSupply();
        }
    }

    /// @notice Deposits and stakes funds in Stargate.
    /// @param amount The amount of {token} to deposit.
    function _stargateDeposit(uint256 amount) internal {
        IERC20(token).approve(address(stargateRouter), amount);
        stargateRouter.addLiquidity(stargateRouterPoolId, amount, address(this));
        uint256 receivedLpToken = IERC20(stargateLpToken).balanceOf(address(this));
        IERC20(stargateLpToken).approve(address(stargateLpStaking), receivedLpToken);
        stargateLpStaking.deposit(stargateLpStakingPoolId, receivedLpToken);
    }

    /// @notice Returns the LP balance staked in Stargate.
    /// @return The LP amount staked.
    function _getStargateLpBalance() internal returns (uint256) {
        (uint256 amount, ) = stargateLpStaking.userInfo(stargateLpStakingPoolId, address(this));
        return amount;
    }

    /// @notice Updates the maximum total balance cap.
    /// @param _cap The new cap to apply.
    function setCap(uint256 _cap) external onlyOwner {
        cap = _cap;
    }

    /// @notice Update the Trading wallet
    /// @param _newTradingWallet New trading wallet
    function setTradingWallet(address _newTradingWallet) external onlyOwner {
        tradingManager = _newTradingWallet;
    }
}
