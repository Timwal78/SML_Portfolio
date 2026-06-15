// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title xMITTreasury
 * @notice Community treasury holding 5% protocol fee from all xMIT modules.
 *         SOVEREIGN/WHALE/LEGEND tier holders vote on allocation via on-chain proposals.
 *         Agent bounty pool funded from treasury — distributed by governance vote.
 */
contract xMITTreasury is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    struct Proposal {
        address recipient;
        uint256 amount;
        string  description;
        uint256 votesFor;
        uint256 votesAgainst;
        uint64  endsAt;
        bool    executed;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    uint256 public proposalCount;

    uint256 public constant VOTE_DURATION = 7 days;
    uint256 public constant QUORUM_AMOUNT = 1000e6; // 1000 USDC vote weight

    event FeeReceived(uint256 amount);
    event ProposalCreated(uint256 indexed id, address recipient, uint256 amount, string description);
    event Voted(uint256 indexed proposalId, address voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed id, address recipient, uint256 amount);

    constructor(address _usdc, address _owner) Ownable(_owner) {
        usdc = IERC20(_usdc);
    }

    function receiveFee(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit FeeReceived(amount);
    }

    function createProposal(
        address recipient,
        uint256 amount,
        string calldata description
    ) external onlyOwner returns (uint256 id) {
        id = proposalCount++;
        proposals[id] = Proposal({
            recipient:    recipient,
            amount:       amount,
            description:  description,
            votesFor:     0,
            votesAgainst: 0,
            endsAt:       uint64(block.timestamp + VOTE_DURATION),
            executed:     false
        });
        emit ProposalCreated(id, recipient, amount, description);
    }

    function vote(uint256 proposalId, bool support, uint256 weight) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp < p.endsAt, "Voting ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        hasVoted[proposalId][msg.sender] = true;
        if (support) p.votesFor += weight;
        else p.votesAgainst += weight;

        emit Voted(proposalId, msg.sender, support, weight);
    }

    function executeProposal(uint256 proposalId) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp >= p.endsAt, "Voting not ended");
        require(!p.executed, "Already executed");
        require(p.votesFor > p.votesAgainst, "Proposal failed");
        require(p.votesFor >= QUORUM_AMOUNT, "Quorum not met");

        p.executed = true;
        usdc.safeTransfer(p.recipient, p.amount);
        emit ProposalExecuted(proposalId, p.recipient, p.amount);
    }

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
