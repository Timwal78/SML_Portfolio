// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title xAAPAgentRewards — On-chain affiliate tracking for AI agents.
/// @notice Agents identified by X-AGENT-ID header earn 15% of protocol fees
///         from all traffic they route. Monthly leaderboard + bounty pool.
contract xAAPAgentRewards is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC;

    struct AgentRecord {
        address owner;          // Wallet that receives payouts
        string  name;
        uint128 totalVolumeUsdc;
        uint128 lifetimePayoutUsdc;
        uint64  totalReferrals;
        uint32  registeredAt;
        uint32  lastActiveAt;
    }

    mapping(bytes32 => AgentRecord) public agents;  // keccak256(agentId) => record
    mapping(bytes32 => uint256)     public pending;  // keccak256(agentId) => claimable

    uint256 public monthlyBountyPool;
    uint256 public currentMonthVolume;

    event AgentRegistered(bytes32 indexed agentKey, string name, address owner);
    event EarningsAccrued(bytes32 indexed agentKey, uint256 amount);
    event EarningsClaimed(bytes32 indexed agentKey, address to, uint256 amount);
    event BountyPoolFunded(uint256 amount);
    event BountyAwarded(bytes32 indexed agentKey, uint256 amount, string reason);

    constructor(address _usdc) Ownable(msg.sender) {
        USDC = IERC20(_usdc);
    }

    function registerAgent(string calldata agentId, string calldata name, address owner) external {
        bytes32 key = keccak256(bytes(agentId));
        require(agents[key].owner == address(0), "already registered");
        require(owner != address(0), "zero owner");
        agents[key] = AgentRecord({
            owner: owner, name: name,
            totalVolumeUsdc: 0, lifetimePayoutUsdc: 0,
            totalReferrals: 0,
            registeredAt: uint32(block.timestamp),
            lastActiveAt: uint32(block.timestamp)
        });
        emit AgentRegistered(key, name, owner);
    }

    /// @notice Called by xAAPCore when a sale is attributed to an agent.
    function accrueEarnings(string calldata agentId, uint256 saleAmount, uint256 fee) external onlyOwner {
        bytes32 key = keccak256(bytes(agentId));
        AgentRecord storage a = agents[key];
        require(a.owner != address(0), "agent not found");
        pending[key]              += fee;
        a.totalVolumeUsdc         += uint128(saleAmount);
        a.totalReferrals          += 1;
        a.lastActiveAt             = uint32(block.timestamp);
        currentMonthVolume        += saleAmount;
        emit EarningsAccrued(key, fee);
    }

    function claimEarnings(string calldata agentId) external nonReentrant {
        bytes32 key = keccak256(bytes(agentId));
        AgentRecord storage a = agents[key];
        require(msg.sender == a.owner, "not owner");
        uint256 amount = pending[key];
        require(amount > 0, "nothing to claim");
        pending[key] = 0;
        a.lifetimePayoutUsdc += uint128(amount);
        USDC.safeTransfer(a.owner, amount);
        emit EarningsClaimed(key, a.owner, amount);
    }

    function fundBountyPool(uint256 amount) external onlyOwner {
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        monthlyBountyPool += amount;
        emit BountyPoolFunded(amount);
    }

    function awardBounty(string calldata agentId, uint256 amount, string calldata reason) external onlyOwner nonReentrant {
        bytes32 key = keccak256(bytes(agentId));
        AgentRecord storage a = agents[key];
        require(a.owner != address(0), "agent not found");
        require(amount <= monthlyBountyPool, "exceeds pool");
        monthlyBountyPool -= amount;
        USDC.safeTransfer(a.owner, amount);
        emit BountyAwarded(key, amount, reason);
    }
}
