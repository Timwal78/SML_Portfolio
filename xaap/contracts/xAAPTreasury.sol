// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title xAAPTreasury — Community treasury + legal defense fund.
/// @notice Receives 5% of all protocol fees. Governed by AUDITOR+ tier holders.
///         Allocations: grants, legal defense, marketing, bug bounties.
contract xAAPTreasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC;

    enum ProposalType { GRANT, LEGAL_DEFENSE, MARKETING, BUG_BOUNTY, OTHER }
    enum ProposalStatus { PENDING, APPROVED, REJECTED, EXECUTED }

    struct Proposal {
        address proposer;
        address payTo;
        uint256 amountUsdc;
        ProposalType pType;
        ProposalStatus status;
        string  description;
        uint32  createdAt;
        uint32  executedAt;
        uint32  voteYes;
        uint32  voteNo;
    }

    address public reputationContract;  // For tier-gating votes
    uint256 public proposalCount;
    uint256 public constant TIMELOCK = 2 days;

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event Received(address from, uint256 amount);
    event ProposalCreated(uint256 indexed id, address proposer, uint256 amount, ProposalType pType);
    event Voted(uint256 indexed id, address voter, bool support);
    event ProposalExecuted(uint256 indexed id, address payTo, uint256 amount);
    event ProposalRejected(uint256 indexed id);

    constructor(address _usdc) Ownable(msg.sender) {
        USDC = IERC20(_usdc);
    }

    receive() external payable {}

    /// @notice Accept USDC from core protocol
    function receiveProtocolFees(uint256 amount) external {
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit Received(msg.sender, amount);
    }

    function createProposal(
        address payTo,
        uint256 amount,
        ProposalType pType,
        string calldata description
    ) external returns (uint256 id) {
        require(amount > 0, "zero amount");
        require(payTo != address(0), "zero payTo");
        require(USDC.balanceOf(address(this)) >= amount, "insufficient treasury");

        id = proposalCount++;
        proposals[id] = Proposal({
            proposer: msg.sender,
            payTo: payTo,
            amountUsdc: amount,
            pType: pType,
            status: ProposalStatus.PENDING,
            description: description,
            createdAt: uint32(block.timestamp),
            executedAt: 0,
            voteYes: 0,
            voteNo: 0
        });
        emit ProposalCreated(id, msg.sender, amount, pType);
    }

    function vote(uint256 id, bool support) external {
        Proposal storage p = proposals[id];
        require(p.status == ProposalStatus.PENDING, "not pending");
        require(!hasVoted[id][msg.sender], "already voted");
        hasVoted[id][msg.sender] = true;
        if (support) p.voteYes++; else p.voteNo++;
        emit Voted(id, msg.sender, support);
    }

    function executeProposal(uint256 id) external onlyOwner nonReentrant {
        Proposal storage p = proposals[id];
        require(p.status == ProposalStatus.PENDING, "not pending");
        require(block.timestamp >= p.createdAt + TIMELOCK, "timelock");
        require(p.voteYes > p.voteNo, "not approved");
        require(USDC.balanceOf(address(this)) >= p.amountUsdc, "insufficient");

        p.status = ProposalStatus.EXECUTED;
        p.executedAt = uint32(block.timestamp);
        USDC.safeTransfer(p.payTo, p.amountUsdc);
        emit ProposalExecuted(id, p.payTo, p.amountUsdc);
    }

    function rejectProposal(uint256 id) external onlyOwner {
        proposals[id].status = ProposalStatus.REJECTED;
        emit ProposalRejected(id);
    }

    function setReputationContract(address _rep) external onlyOwner {
        reputationContract = _rep;
    }

    function balance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }
}
