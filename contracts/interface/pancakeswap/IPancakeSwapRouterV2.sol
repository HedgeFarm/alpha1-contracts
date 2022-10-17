// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPancakeSwapRouterV2 {
    function WETH() external pure returns (address);
    function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts);
}