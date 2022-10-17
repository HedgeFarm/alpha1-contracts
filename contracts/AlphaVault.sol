// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interface/alphavault/IGMXPositionManager.sol";
import "./interface/stargate/IStargateRouter.sol";
import "./interface/stargate/IStargateLpStaking.sol";
import "./interface/stargate/IStargatePool.sol";
import "./interface/traderjoe/IJoeRouter02.sol";
import "./librairies/ECDSA.sol";

/// @title AlphaVault
/// @author HedgeFarm
/// @notice A vault with simple epoch gestion for the alpha 1 strategy of HedgeFarm.
contract AlphaVault is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    /// @notice The token that can be deposited or withdrawn.
    address public token;
    /// @notice The number of token decimals.
    uint8 public tokenDecimals;
    /// @notice The signer for the deposits' signatures.
    address public signer;
    /// @notice The vault manager can start, stop and manage positions.
    address public manager;
    /// @notice The address getting the fees.
    address public feeRecipient;
    // @notice The swap router of TraderJoe
    address public swapRouter = address(0x60aE616a2155Ee3d9A68541Ba4544862310933d4);
    /// @notice Boolean to indicate if the strategy is running and has allocated funds in a lending protocol.
    bool public isEpochRunning;

    /// @notice The maximum total balance cap for the strategy.
    uint256 public cap;
    /// @notice The minimum amount that can be deposited.
    uint256 public minDeposit = 500;
    /// @notice The maximum amount that can be deposited.
    uint256 public maxDeposit = 50000;
    /// @notice The current management fee.
    uint8 public managementFee = 0;
    /// @notice The current performance fee.
    uint8 public performanceFee = 0;

    /// @notice When funds are allocated, stores the last relevant price per IOU.
    uint256 public lastPricePerShare;
    /// @notice When funds are allocated, stores the last relevant total balance.
    uint256 public lastTotalBalance;
    /// @notice The moment when the epoch started.
    uint256 public lastEpochStart;

    /// @notice Stargate lending addresses.
    IStargateLpStaking public stargateLpStaking;
    IStargateRouter public stargateRouter = IStargateRouter(0x45A01E4e04F14f7A4a6702c74187c5F6222033cd);
    address public stargateLpToken;
    address public stgToken = address(0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590);
    uint8 public stargateRouterPoolId;
    uint8 public stargateLpStakingPoolId;

    /// @notice AlphaVault helper to open/close positions on GMX.
    address public gmxPositionManager;
    /// @notice Boolean to indicate where the trading period has stopped.
    bool public isTrading;
    /// @notice Count of long/short positions currently opened.
    uint256 public currentOpenPositions = 0;

    modifier onlyManagerOwner {
        require(msg.sender == owner() || msg.sender == manager, "Unauthorized");
        _;
    }

    /// @notice This event is triggered when a deposit is completed.
    /// @param from The address depositing funds.
    /// @param amount The amount in {token} deposited.
    event Deposit(address indexed from, uint256 amount);

    /// @notice This event is triggered when a withdraw is completed.
    /// @param to The address withdrawing funds.
    /// @param amount The amount in {token} withdrawn.
    event Withdraw(address indexed to, uint256 amount);

    /// @notice This event is triggered when a harvest is completed.
    event Harvest();

    /// @notice This event is triggered when we start an epoch.
    /// @param totalAmount The amount to be allocated in lending and trading.
    event Start(uint256 totalAmount);

    /// @notice This event is triggered when we stop an epoch.
    /// @param totalAmount The amount from the lending, trading and rewards.
    event Stop(uint256 totalAmount);

    /// @notice Creates a new vault with a {token} that can be lent in Stargate.
    /// @param _name The name of the vault token.
    /// @param _symbol The symbol of the vault token.
    /// @param _token The token that can be deposited or withdrawn.
    /// @param _signer The signer for the deposits' signatures.
    /// @param _manager The address that can start/stop/manage positions.
    /// @param _feeRecipient The recipient of the performance and management fees.
    /// @param _cap The maximum total balance cap of the vault.
    /// @param _stargateLpStaking The contract to stake the Stargate LP token.
    /// @param _stargateLpToken The contract of the Stargate LP token.
    /// @param _stargateRouterPoolId The pool ID of the token for the Stargate router.
    /// @param _stargateLpStakingPoolId The pool ID of the token for Stargate staking.
    constructor(
        string memory _name,
        string memory _symbol,
        address _token,
        address _signer,
        address _manager,
        address _feeRecipient,
        uint256 _cap,
        address _stargateLpStaking,
        address _stargateLpToken,
        uint8 _stargateRouterPoolId,
        uint8 _stargateLpStakingPoolId
    ) ERC20(_name, _symbol) {
        token = _token;
        tokenDecimals = IERC20Metadata(token).decimals();
        signer = _signer;
        manager = _manager;
        feeRecipient = _feeRecipient;
        cap = _cap;
        stargateLpStaking = IStargateLpStaking(_stargateLpStaking);
        stargateLpToken = _stargateLpToken;
        stargateRouterPoolId = _stargateRouterPoolId;
        stargateLpStakingPoolId = _stargateLpStakingPoolId;
        isEpochRunning = false;
    }

    /// @notice Deposit an amount in the contract.
    /// @param _amount The amount of {want} to deposit.
    /// @param _signature An off-chain generated signature to check the allow list participation of the sender
    function deposit(uint256 _amount, bytes calldata _signature) external nonReentrant {
        require(!isEpochRunning, "Disabled when during epoch");
        require((_amount >= minDeposit * 10**tokenDecimals) && (_amount <= maxDeposit * 10**tokenDecimals), "Out of limits");
        require(_amount + totalBalance() <= cap, "Cap reached");

        bytes32 signedMessage = ECDSA.toEthSignedMessageHash(keccak256(abi.encodePacked(msg.sender)));
        require(ECDSA.recover(signedMessage, _signature) == signer, "Not allowed");

        uint256 pool = totalBalance();
        IERC20(token).safeTransferFrom(msg.sender, address(this), _amount);

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
    function withdraw(uint256 _shares) public nonReentrant {
        require(!isEpochRunning, "Disabled when during epoch");
        require(_shares <= balanceOf(msg.sender), "Not enough shares");

        uint256 returnAmount = totalBalance() * _shares / totalSupply();

        _burn(msg.sender, _shares);

        IERC20(token).safeTransfer(msg.sender, returnAmount);

        emit Withdraw(msg.sender, returnAmount);
    }

    /// @notice Starts an epoch and allocates the funds to the lending platform and the trading manager.
    /// It blocks the deposits and withdrawals.
    function start() external onlyManagerOwner nonReentrant {
        require(!isEpochRunning, "Already started");
        require(gmxPositionManager != address(0), "No GMX manager");

        lastTotalBalance = totalBalance();
        lastPricePerShare = pricePerShare();
        // solhint-disable-next-line not-rely-on-time
        lastEpochStart = block.timestamp;

        // Deposit 80% of funds in Stargate
        _stargateDeposit(IERC20(token).balanceOf(address(this)) * 80 / 100);

        // Approve GMX for 20% of funds
        IERC20(token).safeApprove(gmxPositionManager, IERC20(token).balanceOf(address(this)));

        isEpochRunning = true;
        isTrading = true;

        emit Start(lastTotalBalance);
    }

    /// @notice Stops the epoch, withdraws funds from farm, unlocks deposits and withdrawals.
    function stop(uint16 fromChainId) external payable onlyManagerOwner nonReentrant {
        require(isEpochRunning, "Already stopped");
        require(!isTrading, "Confirm trading stopped first");

        harvest(false);

        if (isSyncWithdrawalPossible()) {
            _stargateSyncRedeem();
        } else {
            _stargateAsyncRedeem(fromChainId);
        }

        IERC20(token).safeApprove(gmxPositionManager, 0);
    }

    /// @notice Harvests and sells the rewards of the lending farm.
    /// @param autocompound Boolean to indicate if it should auto-compound the rewards.
    function harvest(bool autocompound) public onlyManagerOwner {
        require(isEpochRunning, "No funds in lending");

        // Putting 0 will harvest
        stargateLpStaking.deposit(stargateLpStakingPoolId, 0);

        uint256 stgBalance = IERC20(stgToken).balanceOf(address(this));
        IERC20(stgToken).safeApprove(swapRouter, stgBalance);

        address[] memory path = new address[](3);
        path[0] = stgToken;
        path[1] = IJoeRouter02(swapRouter).WAVAX();
        path[2] = token;
        // solhint-disable-next-line not-rely-on-time
        IJoeRouter02(swapRouter).swapExactTokensForTokens(stgBalance, 0, path, address(this), block.timestamp + 10);

        if (autocompound) {
            _stargateDeposit(IERC20(token).balanceOf(address(this)));
        }

        emit Harvest();
    }

    /// @notice Opens a GMX position for a token.
    /// @param indexToken The address of the token that is longed or shorted.
    /// @param tokenAmount The amount in vault {token} to use as collateral.
    /// @param isLong If we long or if we short.
    function openPosition(address indexToken, uint256 tokenAmount, bool isLong) external payable onlyManagerOwner {
        require(gmxPositionManager != address(0), "No position manager");
        require(isTrading, "Not trading period");
        require(msg.value == 0.02 ether, "Wrong value");
        require(tokenAmount > 10 * 1e6, "Min amount not met");

        IGMXPositionManager(gmxPositionManager).openPosition{value: msg.value}(indexToken, tokenAmount, isLong);

        currentOpenPositions += 1;
    }

    /// @notice Closes the GMX position for a token.
    /// @param indexToken The address of the token that is longed or shorted.
    /// @param isLong If we long or if we short.
    function closePosition(address indexToken, bool isLong) external payable onlyManagerOwner {
        require(gmxPositionManager != address(0), "No position manager");
        require(isTrading, "Not trading period");
        require(msg.value == 0.02 ether, "Wrong value");

        IGMXPositionManager(gmxPositionManager).closePosition{value: msg.value}(indexToken, isLong);

        currentOpenPositions -= 1;
    }

    /// @notice Confirms that all positions were executed and that we can stop.
    function confirmTradesClosed() external onlyManagerOwner {
        require(currentOpenPositions == 0, "Close all positions on GMX");
        isTrading = false;
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
        IERC20(token).safeApprove(address(stargateRouter), amount);
        stargateRouter.addLiquidity(stargateRouterPoolId, amount, address(this));
        uint256 receivedLpToken = IERC20(stargateLpToken).balanceOf(address(this));
        IERC20(stargateLpToken).safeApprove(address(stargateLpStaking), receivedLpToken);
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

        _computeFees();

        isEpochRunning = false;
        emit Stop(IERC20(token).balanceOf(address(this)));
    }

    /// @notice Does an async redeem from Stargate.
    /// @param fromChainId The chain id where the Stargate funds should be coming.
    function _stargateAsyncRedeem(uint16 fromChainId) internal {
        require(msg.value >= 0.3 * 10 ** 18, "RedeemLocal requires funds");

        uint256 totalLpTokens = _getStargateLpBalance();
        stargateLpStaking.withdraw(stargateLpStakingPoolId, totalLpTokens);

        IStargateRouter.lzTxObj memory lzTxObj = IStargateRouter.lzTxObj(0, 0, "0x");
        stargateRouter.redeemLocal{value: 0.3 * 10 ** 18}(
            fromChainId,
            stargateRouterPoolId, // source pool
            stargateRouterPoolId, // destination pool
            payable(address(msg.sender)), // refund extra native gas to this address
            totalLpTokens, // the amount of LP to withdraw
            abi.encodePacked(address(this)), // receiver
            lzTxObj
        );
    }

    /// @notice Admin helper to confirm Stargate async withdraw completed and to close the eopch.
    function confirmStargateAsyncRedeem() external onlyManagerOwner {
        _computeFees();
        isEpochRunning = false;
        emit Stop(IERC20(token).balanceOf(address(this)));
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

    /// @notice Computes the management and the performance fee and executes them.
    function _computeFees() internal {
        // Management fee
        // solhint-disable-next-line not-rely-on-time
        uint256 managementFeeAmount = lastTotalBalance * (block.timestamp - lastEpochStart) / (60 * 60 * 24 * 365) * managementFee / 100;
        _mint(feeRecipient, managementFeeAmount * totalSupply() / lastTotalBalance);

        // Performance fee
        int256 delta = int256(IERC20(token).balanceOf(address(this))) - int256(lastTotalBalance);
        if (delta > 0) {
            uint256 performanceFeeAmount = uint256(delta) * performanceFee / 100;
            IERC20(token).safeTransfer(feeRecipient, performanceFeeAmount);
        }
    }

    /// @notice Updates the maximum total balance cap.
    /// @param _cap The new cap to apply.
    function setCap(uint256 _cap) external onlyOwner {
        cap = _cap;
    }

    /// @notice Sets a new GMX position manager.
    /// @param _gmxPositionManager The address of the GMX position manager.
    function setGMXPositionManager(address _gmxPositionManager) external onlyOwner {
        gmxPositionManager = _gmxPositionManager;
    }

    /// @notice Sets a new swap router.
    /// @param _swapRouter The address of the new swap router.
    function setSwapRouter(address _swapRouter) external onlyOwner {
        swapRouter = _swapRouter;
    }

    /// @notice Sets a new manager.
    /// @param _manager The address of the new manager.
    function setManager(address _manager) external onlyOwner {
        manager = _manager;
    }

    /// @notice Sets a fee recipient.
    /// @param _feeRecipient The address of the new fee recipient.
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        feeRecipient = _feeRecipient;
    }

    /// @notice Sets the management and the performance fee.
    /// @param _managementFee The amount (in percent) of management fee.
    /// @param _performanceFee The amount (in percent) of performance fee.
    function setFees(uint8 _managementFee, uint8 _performanceFee) external onlyOwner {
        require(_managementFee <= 2, "Fee too high");
        require(_performanceFee <= 20, "Fee too high");
        managementFee = _managementFee;
        performanceFee = _performanceFee;
    }

    /// @notice Sets the limits of the minimum and maximum amount that you can deposit.
    /// @param _minDeposit The minimum amount (without decimals)
    /// @param _maxDeposit The maximum amount (Without decimals)
    function setDepositLimits(uint256 _minDeposit, uint256 _maxDeposit) external onlyOwner {
        minDeposit = _minDeposit;
        maxDeposit = _maxDeposit;
    }

    /// @notice Sets a new signer for the allowlist.
    /// @param _signer The address of the new signer.
    function setSigner(address _signer) external onlyOwner {
        signer = _signer;
    }
}
