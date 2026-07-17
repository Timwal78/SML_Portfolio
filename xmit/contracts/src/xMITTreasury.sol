// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title xMITTreasury
 * @notice Holds the 5% protocol fee from all xMIT modules.
 *         Owner withdraws at will — no bounty pool, no governance votes.
 *         Affiliate rev-share (15%) is tracked off-chain and paid out via withdraw().
 */
contract xMITTreasury is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    event FeeReceived(uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    constructor(address _usdc, address _owner) Ownable(_owner) {
        usdc = IERC20(_usdc);
    }

    function receiveFee(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit FeeReceived(amount);
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function withdrawAll(address to) external onlyOwner {
        uint256 bal = usdc.balanceOf(address(this));
        usdc.safeTransfer(to, bal);
        emit Withdrawn(to, bal);
    }

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
