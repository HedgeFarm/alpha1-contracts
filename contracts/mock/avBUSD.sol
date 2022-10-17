// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract avBUSD is ERC20 {

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 100000000000000000000000);
        _mint(0xe2DFD80612241B1Db5d2dEA649FEd77F3851951D, 100000000000000000000000);
    }

    function mint(uint256 amount) external {
        _mint(msg.sender, amount);
    }

}