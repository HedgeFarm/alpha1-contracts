// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Mock is ERC20, Ownable {

    /// @notice The token that can be deposited or withdrawn.
    address public token;
    /// @notice Boolean to indicate if the strategy is running and has allocated funds in a lending protocol.
    bool public isEpochRunning;
    /// @notice Boolean to indicate if the strategy has some funds in the trading manager for longs/shorts.
    bool public isTrading;
    /// @notice The maximum total balance cap for the strategy.
    uint256 public cap = 10000000000000000000000; // 10000 * 1e18

    mapping(address => bool) public team;

    enum Farms{ ALPACA, STARGATE, UNKNOWN }

    event Deposit(address indexed from, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);

    modifier onlyTeam() {
        require(team[msg.sender] == true, "only team");
        _;
    }

    constructor(string memory _name, string memory _symbol, address _token) ERC20(_name, _symbol) {
        team[0xacE4DB860d9Db380d5AEffac51c223e024CB9bD6] = true;
        team[0xe2DFD80612241B1Db5d2dEA649FEd77F3851951D] = true;

        token = _token;
        isEpochRunning = false;
        isTrading = false;
    }

    function deposit(uint256 _amount) external onlyTeam {
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

    function withdraw(uint256 _shares) external onlyTeam {
        require(!isEpochRunning, "Disabled when during epoch");
        require(_shares <= balanceOf(msg.sender), "Not enough shares");

        uint256 returnAmount = totalBalance() * _shares / totalSupply();

        _burn(msg.sender, _shares);

        IERC20(token).transfer(msg.sender, returnAmount);

        emit Withdraw(msg.sender, returnAmount);
    }

    function start(Farms farm) external onlyTeam {
        isEpochRunning = true;
        isTrading = true;
    }

    function stop() external onlyTeam {
        isEpochRunning = false;
        isTrading = false;
    }

    function totalBalance() public view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function pricePerShare() public view returns (uint256) {
        return totalSupply() == 0 ? 1e18 : totalBalance() * 1e18 / totalSupply();
    }

    function setCap(uint256 _cap) external onlyTeam {
        cap = _cap;
    }
}
