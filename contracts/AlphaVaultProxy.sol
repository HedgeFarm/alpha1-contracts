// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "./interface/alphavault/IYieldManager.sol";

/// @title AlphaVaultProxy
/// @author HedgeFarm
/// @notice A vault with simple epoch gestion for the Alpha 1 strategy of HedgeFarm.
contract AlphaVaultProxy is ERC20Upgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    /// @notice The token that can be deposited or withdrawn.
    address public token;
    /// @notice The number of token decimals.
    uint8 public tokenDecimals;
    /// @notice The vault manager can start, stop and receive USDC to manage the positions.
    address public manager;
    /// @notice The address getting the fees.
    address public feeRecipient;

    /// @notice Boolean to indicate if the strategy is running and has allocated funds in a lending protocol.
    bool public isEpochRunning;
    /// @notice Boolean to indicate where the trading period has stopped.
    bool public isTrading;

    /// @notice The maximum total balance cap for the strategy.
    uint256 public cap;
    /// @notice The current management fee.
    uint8 public managementFee;
    /// @notice The current performance fee.
    uint8 public performanceFee;

    /// @notice When funds are allocated, stores the last relevant price per IOU.
    uint256 public lastPricePerShare;
    /// @notice When funds are allocated, stores the last relevant total balance.
    uint256 public lastTotalBalance;
    /// @notice The moment when the epoch started.
    uint256 public lastEpochStart;

    /// @notice AlphaVault helper to manage the yield position.
    address public yieldManager;

    modifier onlyManagerOwner {
        require(msg.sender == owner() || msg.sender == manager, "Unauthorized");
        _;
    }

    /// @notice This event is triggered when a deposit is completed.
    /// @param from The address depositing funds.
    /// @param amount The amount in {token} deposited.
    event Deposit(address indexed from, uint256 indexed amount);

    /// @notice This event is triggered when a withdraw is completed.
    /// @param to The address withdrawing funds.
    /// @param amount The amount in {token} withdrawn.
    event Withdraw(address indexed to, uint256 indexed amount);

    /// @notice This event is triggered when a harvest is completed.
    event Harvest();

    /// @notice This event is triggered when we start an epoch.
    /// @param totalAmount The amount to be allocated in lending and trading.
    event Start(uint256 indexed totalAmount);

    /// @notice This event is triggered when we stop an epoch.
    /// @param totalAmount The amount from the lending, trading and rewards.
    event Stop(uint256 indexed totalAmount);

    /// @notice This event is triggered when we change the manager.
    /// @param newManager The address of the new manager.
    event ManagerChanged(address indexed newManager);

    /// @notice This event is triggered when we change the fee recipient.
    /// @param newFeeRecipient The address of the new fee recipient.
    event FeeRecipientChanged(address indexed newFeeRecipient);

    /// @notice This event is triggered when we change the yield manager.
    /// @param newYieldManager The address of the new yield manager.
    event YieldManagerChanged(address indexed newYieldManager);

    /// @notice Creates a new vault with a {token} that can be lent in a yield protocol.
    /// @param _name The name of the vault token.
    /// @param _symbol The symbol of the vault token.
    /// @param _token The token that can be deposited or withdrawn.
    /// @param _manager The address that can start/stop/manage positions.
    /// @param _feeRecipient The recipient of the performance and management fees.
    /// @param _cap The maximum total balance cap of the vault.
    function initialize(
        string memory _name,
        string memory _symbol,
        address _token,
        address _manager,
        address _feeRecipient,
        uint256 _cap
    ) external initializer {
        __ERC20_init(_name, _symbol);
        __Ownable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        token = _token;
        tokenDecimals = IERC20MetadataUpgradeable(token).decimals();
        manager = _manager;
        feeRecipient = _feeRecipient;
        cap = _cap;

        isEpochRunning = false;
        managementFee = 0;
        performanceFee = 0;
    }

    /// @notice Function called by {upgradeTo} and {upgradeToAndCall} to upgrade implementation.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @notice Returns the current implementation address.
    /// @return The address of the implementation.
    ///
    function getImplementation() external view returns (address) {
        return _getImplementation();
    }

    /// @notice Deposit an amount in the contract.
    /// @param _amount The amount of {want} to deposit.
    function deposit(uint256 _amount) external nonReentrant {
        require(!isEpochRunning, "Disabled when during epoch");
        require(_amount + totalBalance() <= cap, "Cap reached");

        uint256 pool = totalBalance();
        IERC20Upgradeable(token).safeTransferFrom(msg.sender, address(this), _amount);

        uint256 shares = 0;
        if (totalSupply() == 0) {
            require(_amount >= 10 * 10**tokenDecimals, "Min amount not met");
            shares = _amount;
        } else {
            shares = _amount * totalSupply() / pool;
        }

        require(shares > 0, "No shares");
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
        require(_shares > 0, "Withdraw is 0");
        require(_shares <= balanceOf(msg.sender), "Not enough shares");

        uint256 returnAmount = totalBalance() * _shares / totalSupply();

        _burn(msg.sender, _shares);

        IERC20Upgradeable(token).safeTransfer(msg.sender, returnAmount);

        emit Withdraw(msg.sender, returnAmount);
    }

    /// @notice Starts an epoch and allocates the funds to the lending platform and the trading manager.
    /// It blocks the deposits and withdrawals.
    function start() external onlyManagerOwner nonReentrant {
        require(!isEpochRunning, "Already started");
        require(yieldManager != address(0), "No yield manager");

        lastTotalBalance = totalBalance();
        lastPricePerShare = pricePerShare();
        // solhint-disable-next-line not-rely-on-time
        lastEpochStart = block.timestamp;

        // Deposit 80% of funds in yield protocol
        uint256 yieldAmount = IERC20Upgradeable(token).balanceOf(address(this)) * 80 / 100;
        uint256 managerAmount = IERC20Upgradeable(token).balanceOf(address(this)) - yieldAmount;

        IERC20Upgradeable(token).safeApprove(yieldManager, yieldAmount);
        IYieldManager(yieldManager).deposit(yieldAmount);

        // Send 20% of funds to manager
        IERC20Upgradeable(token).safeTransfer(manager, managerAmount);

        isEpochRunning = true;
        isTrading = true;

        emit Start(lastTotalBalance);
    }

    /// @notice Stops the epoch, withdraws funds from farm, unlocks deposits and withdrawals.
    function stop() external payable onlyManagerOwner nonReentrant {
        require(isEpochRunning, "Already stopped");
        require(!isTrading, "Confirm trading stopped first");

        harvest(false);

        bool fundsRedeemedSync = IYieldManager(yieldManager).withdraw{value: msg.value}();

        if (fundsRedeemedSync) {
            _confirmStop();
        }

        IERC20Upgradeable(token).safeApprove(yieldManager, 0);
    }

    /// @notice Admin helper to confirm async withdraw completed and to close the eopch.
    function confirmAsyncRedeem() external onlyManagerOwner {
        _confirmStop();
    }

    /// @notice Executes the actions required before closing the epoch.
    function _confirmStop() internal {
        isEpochRunning = false;
        _computeFees();

        emit Stop(IERC20Upgradeable(token).balanceOf(address(this)));
    }

    /// @notice Harvests and sells the rewards of the lending farm.
    /// @param autocompound Boolean to indicate if it should auto-compound the rewards.
    function harvest(bool autocompound) public onlyManagerOwner {
        require(isEpochRunning, "No funds in lending");
        IYieldManager(yieldManager).harvest(autocompound);
        emit Harvest();
    }

    /// @notice Confirms that all positions were executed and that we can stop.
    function confirmTradesClosed() external onlyManagerOwner {
        isTrading = false;
    }

    /// @notice Returns the total balance of {token} in strategy. When funds are allocated, it returns the last relevant balance.
    /// @return The total balance amount in {token}.
    function totalBalance() public view returns (uint256) {
        if (isEpochRunning) {
            return lastTotalBalance;
        } else {
            return IERC20Upgradeable(token).balanceOf(address(this));
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

    /// @notice Computes the management and the performance fee and executes them.
    function _computeFees() internal {
        // Management fee
        if (managementFee > 0) {
            // solhint-disable-next-line not-rely-on-time
            uint256 managementFeeAmount = lastTotalBalance * (block.timestamp - lastEpochStart) / (60 * 60 * 24 * 365) * managementFee / 100;
            _mint(feeRecipient, managementFeeAmount * totalSupply() / lastTotalBalance);
        }

        // Performance fee
        if (performanceFee > 0) {
            int256 delta = int256(IERC20Upgradeable(token).balanceOf(address(this))) - int256(lastTotalBalance);
            if (delta > 0) {
                uint256 performanceFeeAmount = uint256(delta) * performanceFee / 100;
                IERC20Upgradeable(token).safeTransfer(feeRecipient, performanceFeeAmount);
            }
        }
    }

    /// @notice Updates the maximum total balance cap.
    /// @param _cap The new cap to apply.
    function setCap(uint256 _cap) external onlyOwner {
        cap = _cap;
    }

    /// @notice Sets a new manager.
    /// @param _manager The address of the new manager.
    function setManager(address _manager) external onlyOwner {
        require(_manager != address(0), "Address can't be 0");
        manager = _manager;
        emit ManagerChanged(_manager);
    }

    /// @notice Sets a fee recipient.
    /// @param _feeRecipient The address of the new fee recipient.
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "Address can't be 0");
        feeRecipient = _feeRecipient;
        emit FeeRecipientChanged(_feeRecipient);
    }

    /// @notice Sets a new yield manager.
    /// @param _yieldManager The address of the yield manager.
    function setYieldManager(address _yieldManager) external onlyOwner {
        require(_yieldManager != address(0), "Address can't be 0");
        yieldManager = _yieldManager;
        emit YieldManagerChanged(_yieldManager);
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

    /// @notice Helper function in case random tokens are sent to the contract. Doesn't work for {token}.
    /// @param _rescueToken The address of the stuck token.
    function rescue(address _rescueToken) external onlyManagerOwner {
        require(_rescueToken != token, "No rug");
        IERC20Upgradeable(_rescueToken).safeTransfer(msg.sender, IERC20Upgradeable(_rescueToken).balanceOf(address(this)));
    }
}
