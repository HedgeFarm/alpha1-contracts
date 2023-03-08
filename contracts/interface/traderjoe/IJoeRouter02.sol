// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IJoeRouter02 {
    function WAVAX() external pure returns (address);
    function getAmountsOut(uint256 amountIn, address[] calldata path) external returns (uint256[] memory amounts);
    function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint256[] memory amounts);
}