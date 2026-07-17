// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {xMITReputation} from "./xMITReputation.sol";
import {xMITTreasury} from "./xMITTreasury.sol";

/**
 * @title xMITCore
 * @notice Central protocol registry. Records insight submissions and outcome scoring.
 *         Does NOT handle user funds — x402 payments are P2P directly to analysts.
 *         Only tracks protocol metadata and triggers reputation updates.
 */
contract xMITCore is Ownable, ReentrancyGuard {
    enum Module    { XCGO, XSTM, XIFD }
    enum Verdict   { PENDING, CORRECT, INCORRECT, UNRESOLVABLE }

    struct Insight {
        bytes32  id;           // keccak256(analystAddress, ticker, nonce)
        address  analyst;
        Module   module;
        bytes32  ticker;       // left-padded ASCII ticker (up to 32 chars)
        bytes32  evidenceHash; // keccak256 of full evidence JSON (stored off-chain)
        uint64   submittedAt;
        uint64   scoredAt;
        uint128  priceMicro;   // USDC micros (1e6 = $1)
        Verdict  verdict;
        int128   reputationDelta;
    }

    xMITReputation public immutable reputation;
    xMITTreasury   public immutable treasury;

    mapping(bytes32 => Insight) public insights;
    mapping(address => uint256) public analystNonce;

    uint256 public constant PROTOCOL_FEE_BPS = 500; // 5%
    uint256 public constant REFERRAL_FEE_BPS = 1000; // 10% of protocol fee to referrer

    event InsightSubmitted(
        bytes32 indexed id,
        address indexed analyst,
        Module module,
        bytes32 ticker,
        uint128 priceMicro,
        bytes32 evidenceHash
    );

    event InsightScored(
        bytes32 indexed id,
        address indexed analyst,
        Verdict verdict,
        int128 reputationDelta
    );

    event AffiliateRewarded(address indexed agent, uint256 feeMicro);

    constructor(address _reputation, address _treasury, address _owner)
        Ownable(_owner)
    {
        reputation = xMITReputation(_reputation);
        treasury   = xMITTreasury(_treasury);
    }

    function registerAndSubmit(
        Module  module,
        bytes32 ticker,
        bytes32 evidenceHash,
        uint128 priceMicro
    ) external returns (bytes32 insightId) {
        // Register analyst if first time
        if (!reputation.profiles(msg.sender).exists) {
            reputation.registerAnalyst(msg.sender);
        }

        uint256 nonce = analystNonce[msg.sender]++;
        insightId = keccak256(abi.encodePacked(msg.sender, ticker, nonce));

        insights[insightId] = Insight({
            id:              insightId,
            analyst:         msg.sender,
            module:          module,
            ticker:          ticker,
            evidenceHash:    evidenceHash,
            submittedAt:     uint64(block.timestamp),
            scoredAt:        0,
            priceMicro:      priceMicro,
            verdict:         Verdict.PENDING,
            reputationDelta: 0
        });

        emit InsightSubmitted(insightId, msg.sender, module, ticker, priceMicro, evidenceHash);
    }

    function scoreInsight(
        bytes32 insightId,
        Verdict verdict,
        int128  reputationDelta
    ) external onlyOwner nonReentrant {
        Insight storage ins = insights[insightId];
        require(ins.id != bytes32(0), "Insight not found");
        require(ins.verdict == Verdict.PENDING, "Already scored");

        ins.verdict         = verdict;
        ins.reputationDelta = reputationDelta;
        ins.scoredAt        = uint64(block.timestamp);

        bool correct = verdict == Verdict.CORRECT;
        reputation.recordInsight(ins.analyst, correct, reputationDelta);

        emit InsightScored(insightId, ins.analyst, verdict, reputationDelta);
    }

    function getInsight(bytes32 insightId) external view returns (Insight memory) {
        return insights[insightId];
    }
}
