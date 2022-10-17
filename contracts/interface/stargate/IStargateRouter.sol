// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IStargateRouter {
    struct lzTxObj {
        uint256 dstGasForCall;
        uint256 dstNativeAmount;
        bytes dstNativeAddr;
    }

    function addLiquidity(uint256 poolId, uint256 amount, address to) external;
    function instantRedeemLocal(uint16 poolId, uint256 amountLp, address to) external returns (uint256);
    function redeemLocal(uint16 _dstChainId, uint256 _srcPoolId, uint256 _dstPoolId, address payable _refundAddress, uint256 _amountLP, bytes calldata _to, lzTxObj memory _lzTxParams) external payable;
}