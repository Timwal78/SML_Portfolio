// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title xMITReputation
 * @notice Soulbound reputation NFT — one per analyst, non-transferable.
 *         Reputation score encoded on-chain; tier upgrades emitted as events.
 */
contract xMITReputation is ERC721, Ownable {
    struct AnalystProfile {
        uint256 reputationScore;  // scaled 1e4 (10000 = 100.00)
        uint256 totalInsights;
        uint256 correctInsights;
        uint256 streakDays;
        uint64  lastActiveDay;   // unix day (timestamp / 86400)
        uint8   tier;            // 0=CITIZEN 1=DELEGATE 2=SENATOR 3=PRESIDENT 4=SOVEREIGN
        bool    exists;
    }

    mapping(address => AnalystProfile) public profiles;
    mapping(address => uint256) public tokenOfAnalyst;
    mapping(uint256 => address) public analystOfToken;

    address public coreContract;
    uint256 private _nextTokenId = 1;

    uint256[5] public TIER_THRESHOLDS_INSIGHTS = [0, 5, 20, 50, 100];
    uint256[5] public TIER_THRESHOLDS_ACCURACY = [0, 0, 80, 85, 90]; // percentage

    event ProfileCreated(address indexed analyst, uint256 tokenId);
    event ReputationUpdated(address indexed analyst, uint256 newScore, int256 delta);
    event TierUpgraded(address indexed analyst, uint8 oldTier, uint8 newTier);
    event StreakUpdated(address indexed analyst, uint256 newStreak, uint256 multiplierBps);

    constructor(address _owner) ERC721("xMIT Analyst Reputation", "xREP") Ownable(_owner) {}

    modifier onlyCore() {
        require(msg.sender == coreContract || msg.sender == owner(), "Not authorized");
        _;
    }

    function setCoreContract(address _core) external onlyOwner {
        coreContract = _core;
    }

    function registerAnalyst(address analyst) external onlyCore returns (uint256 tokenId) {
        if (profiles[analyst].exists) return tokenOfAnalyst[analyst];

        tokenId = _nextTokenId++;
        _safeMint(analyst, tokenId);
        tokenOfAnalyst[analyst] = tokenId;
        analystOfToken[tokenId] = analyst;

        profiles[analyst] = AnalystProfile({
            reputationScore: 0,
            totalInsights: 0,
            correctInsights: 0,
            streakDays: 0,
            lastActiveDay: 0,
            tier: 0,
            exists: true
        });

        emit ProfileCreated(analyst, tokenId);
    }

    function recordInsight(
        address analyst,
        bool isCorrect,
        int256 reputationDelta
    ) external onlyCore {
        AnalystProfile storage p = profiles[analyst];
        require(p.exists, "Analyst not registered");

        p.totalInsights++;
        if (isCorrect) p.correctInsights++;

        // Apply streak multiplier
        uint256 streakMultiplierBps = _getStreakMultiplierBps(p.streakDays);
        int256 adjustedDelta = reputationDelta * int256(streakMultiplierBps) / 10000;

        if (adjustedDelta >= 0) {
            p.reputationScore += uint256(adjustedDelta);
        } else {
            uint256 slash = uint256(-adjustedDelta);
            p.reputationScore = p.reputationScore > slash ? p.reputationScore - slash : 0;
        }

        uint8 newTier = _computeTier(p);
        if (newTier > p.tier) {
            emit TierUpgraded(analyst, p.tier, newTier);
            p.tier = newTier;
        }

        emit ReputationUpdated(analyst, p.reputationScore, adjustedDelta);

        // Update streak
        uint64 today = uint64(block.timestamp / 86400);
        if (p.lastActiveDay == 0 || today > p.lastActiveDay + 1) {
            p.streakDays = 1;
        } else if (today == p.lastActiveDay + 1) {
            p.streakDays++;
        }
        p.lastActiveDay = today;
        emit StreakUpdated(analyst, p.streakDays, _getStreakMultiplierBps(p.streakDays));
    }

    function getAccuracyPct(address analyst) external view returns (uint256) {
        AnalystProfile storage p = profiles[analyst];
        if (p.totalInsights == 0) return 0;
        return (p.correctInsights * 100) / p.totalInsights;
    }

    function getTierName(address analyst) external view returns (string memory) {
        uint8 t = profiles[analyst].tier;
        if (t == 0) return "CITIZEN";
        if (t == 1) return "DELEGATE";
        if (t == 2) return "SENATOR";
        if (t == 3) return "PRESIDENT";
        return "SOVEREIGN";
    }

    // Soulbound: block all transfers
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        require(from == address(0), "Soulbound: non-transferable");
        return super._update(to, tokenId, auth);
    }

    function _computeTier(AnalystProfile storage p) private view returns (uint8) {
        uint256 accuracy = p.totalInsights > 0
            ? (p.correctInsights * 100) / p.totalInsights
            : 0;

        for (uint8 t = 4; t > 0; t--) {
            if (
                p.totalInsights >= TIER_THRESHOLDS_INSIGHTS[t] &&
                accuracy >= TIER_THRESHOLDS_ACCURACY[t]
            ) {
                return t;
            }
        }
        return 0;
    }

    function _getStreakMultiplierBps(uint256 streak) private pure returns (uint256) {
        if (streak >= 100) return 50000; // 5x
        if (streak >= 30)  return 25000; // 2.5x
        if (streak >= 7)   return 15000; // 1.5x
        return 10000; // 1x
    }
}
