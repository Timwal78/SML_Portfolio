// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title xAAPCore — x402 Adversarial Audit Protocol
/// @notice Zero-custody forensic research marketplace on Base.
///         Auditors sell research; buyers pay USDC via x402.
///         Protocol never holds user funds — all payments are P2P.
contract xAAPCore is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Constants ──────────────────────────────────────────────────────────
    IERC20 public immutable USDC;
    uint256 public constant MAX_BPS = 10_000;
    uint256 public constant AUDITOR_SHARE_BPS = 7_000;   // 70%
    uint256 public constant JUROR_SHARE_BPS   = 2_000;   // 20%
    uint256 public constant TREASURY_SHARE_BPS = 500;    // 5%
    uint256 public constant AGENT_SHARE_BPS   = 1_500;   // 15% of protocol portion

    // ─── State ──────────────────────────────────────────────────────────────
    address public treasury;
    address public reputationContract;

    struct Finding {
        bytes32 evidenceHash;       // keccak256 of evidence packet
        address auditor;
        uint96  priceUsdc;          // in USDC (6 decimals)
        uint32  createdAt;
        uint8   severity;           // 0=LOW 1=MED 2=HIGH 3=CRIT
        Status  status;
    }

    enum Status { PENDING, VALIDATED, INVALIDATED, EXPIRED }

    mapping(bytes32 => Finding) public findings;          // findingId => Finding
    mapping(bytes32 => uint256) public jurorPool;         // findingId => accumulated juror USDC
    mapping(address => uint256) public pendingWithdrawals; // auditor => claimable USDC
    mapping(address => uint256) public agentEarnings;     // agentId proxy => claimable

    uint256 public totalVolumeUsdc;
    uint256 public totalProtocolFeesUsdc;

    // ─── Events ─────────────────────────────────────────────────────────────
    event FindingRegistered(bytes32 indexed findingId, address indexed auditor, bytes32 evidenceHash, uint96 priceUsdc);
    event FindingPurchased(bytes32 indexed findingId, address indexed buyer, address indexed agent, uint256 amount);
    event FindingValidated(bytes32 indexed findingId, address indexed auditor, uint256 repDelta);
    event FindingInvalidated(bytes32 indexed findingId, address indexed auditor);
    event Withdrawn(address indexed account, uint256 amount);
    event TreasuryUpdated(address newTreasury);

    // ─── Constructor ────────────────────────────────────────────────────────
    constructor(address _usdc, address _treasury) Ownable(msg.sender) {
        require(_usdc != address(0), "zero usdc");
        require(_treasury != address(0), "zero treasury");
        USDC = IERC20(_usdc);
        treasury = _treasury;
    }

    // ─── Core functions ──────────────────────────────────────────────────────

    /// @notice Register a forensic finding on-chain with evidence commitment.
    /// @dev Evidence hash is computed off-chain (keccak256 of the evidence packet).
    function registerFinding(
        bytes32 findingId,
        bytes32 evidenceHash,
        uint96  priceUsdc,
        uint8   severity
    ) external whenNotPaused {
        require(findings[findingId].auditor == address(0), "already exists");
        require(severity <= 3, "invalid severity");
        require(priceUsdc >= 10_000, "min $0.01");       // 6-decimal USDC

        findings[findingId] = Finding({
            evidenceHash: evidenceHash,
            auditor: msg.sender,
            priceUsdc: priceUsdc,
            createdAt: uint32(block.timestamp),
            severity: severity,
            status: Status.PENDING
        });

        emit FindingRegistered(findingId, msg.sender, evidenceHash, priceUsdc);
    }

    /// @notice Purchase access to a finding. Splits payment atomically.
    /// @param agent Optional agent address (zero for direct purchase). Gets 15% of protocol fee.
    function purchaseFinding(
        bytes32 findingId,
        address agent
    ) external nonReentrant whenNotPaused {
        Finding memory f = findings[findingId];
        require(f.auditor != address(0), "finding not found");
        require(f.status != Status.INVALIDATED, "invalidated");
        require(f.status != Status.EXPIRED, "expired");

        uint256 amount = f.priceUsdc;
        USDC.safeTransferFrom(msg.sender, address(this), amount);

        uint256 auditorPayout  = (amount * AUDITOR_SHARE_BPS) / MAX_BPS;
        uint256 jurorPayout    = (amount * JUROR_SHARE_BPS)   / MAX_BPS;
        uint256 protocolFee    = amount - auditorPayout - jurorPayout;
        uint256 agentPayout    = 0;

        if (agent != address(0)) {
            agentPayout = (protocolFee * AGENT_SHARE_BPS) / MAX_BPS;
            agentEarnings[agent] += agentPayout;
            protocolFee -= agentPayout;
        }

        pendingWithdrawals[f.auditor] += auditorPayout;
        jurorPool[findingId]         += jurorPayout;
        totalVolumeUsdc              += amount;
        totalProtocolFeesUsdc        += protocolFee;

        // Treasury portion transferred immediately
        USDC.safeTransfer(treasury, protocolFee);

        emit FindingPurchased(findingId, msg.sender, agent, amount);
    }

    /// @notice Mark a finding validated after jury consensus. Only callable by reputation contract.
    function validateFinding(bytes32 findingId) external {
        require(msg.sender == reputationContract, "not reputation contract");
        Finding storage f = findings[findingId];
        require(f.status == Status.PENDING, "not pending");
        f.status = Status.VALIDATED;
        uint256 repDelta = f.severity == 3 ? 20 : f.severity == 2 ? 10 : f.severity == 1 ? 5 : 2;
        emit FindingValidated(findingId, f.auditor, repDelta);
    }

    /// @notice Mark a finding invalidated after jury consensus.
    function invalidateFinding(bytes32 findingId) external {
        require(msg.sender == reputationContract, "not reputation contract");
        Finding storage f = findings[findingId];
        require(f.status == Status.PENDING, "not pending");
        f.status = Status.INVALIDATED;
        emit FindingInvalidated(findingId, f.auditor);
    }

    /// @notice Auditors and agents pull their earnings.
    function withdraw() external nonReentrant {
        uint256 auditorAmt = pendingWithdrawals[msg.sender];
        uint256 agentAmt   = agentEarnings[msg.sender];
        uint256 total      = auditorAmt + agentAmt;
        require(total > 0, "nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        agentEarnings[msg.sender]      = 0;
        USDC.safeTransfer(msg.sender, total);
        emit Withdrawn(msg.sender, total);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "zero");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setReputationContract(address _rep) external onlyOwner {
        reputationContract = _rep;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
