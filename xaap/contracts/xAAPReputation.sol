// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title xAAPReputation — Soulbound reputation NFTs for xAAP auditors.
/// @notice Non-transferable. Represents on-chain accuracy history.
///         Tier and score are updated by the xAAPCore contract via oracle.
contract xAAPReputation is ERC721, Ownable2Step {

    // Soulbound: block all transfers
    function transferFrom(address, address, uint256) public pure override { revert("SOULBOUND"); }
    function safeTransferFrom(address, address, uint256, bytes memory) public pure override { revert("SOULBOUND"); }

    enum Tier { CITIZEN, DETECTIVE, INVESTIGATOR, AUDITOR, GRAND_INQUISITOR }

    struct AuditorRecord {
        uint64  reputationScore;    // 0–10000 (basis points for precision)
        uint32  totalFindings;
        uint32  validatedFindings;
        uint32  invalidatedFindings;
        uint16  streakDays;
        uint8   tier;               // Tier enum index
        uint32  lastActiveAt;
    }

    mapping(address => AuditorRecord) public records;
    mapping(address => uint256) public tokenOf;
    uint256 private _nextId = 1;

    address public coreContract;

    event AuditorRegistered(address indexed auditor, uint256 tokenId);
    event ReputationUpdated(address indexed auditor, uint64 newScore, uint8 newTier);
    event AchievementAwarded(address indexed auditor, bytes32 badgeId);

    constructor() ERC721("xAAP Reputation", "xAAP-REP") Ownable(msg.sender) {}

    /// @notice Register a new auditor and mint their soulbound rep NFT.
    function register(address auditor) external {
        require(tokenOf[auditor] == 0, "already registered");
        uint256 id = _nextId++;
        tokenOf[auditor] = id;
        _mint(auditor, id);
        records[auditor] = AuditorRecord({
            reputationScore: 0,
            totalFindings: 0,
            validatedFindings: 0,
            invalidatedFindings: 0,
            streakDays: 0,
            tier: uint8(Tier.CITIZEN),
            lastActiveAt: uint32(block.timestamp)
        });
        emit AuditorRegistered(auditor, id);
    }

    /// @notice Update reputation score (called by trusted oracle / core contract).
    function updateReputation(
        address auditor,
        uint64  newScore,
        uint8   newTier,
        uint32  totalFindings,
        uint32  validatedFindings,
        uint32  invalidatedFindings,
        uint16  streakDays
    ) external {
        require(msg.sender == coreContract || msg.sender == owner(), "unauthorized");
        AuditorRecord storage r = records[auditor];
        r.reputationScore       = newScore;
        r.tier                  = newTier;
        r.totalFindings         = totalFindings;
        r.validatedFindings     = validatedFindings;
        r.invalidatedFindings   = invalidatedFindings;
        r.streakDays            = streakDays;
        r.lastActiveAt          = uint32(block.timestamp);
        emit ReputationUpdated(auditor, newScore, newTier);
    }

    function setCoreContract(address _core) external onlyOwner { coreContract = _core; }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        // Metadata served dynamically from xAAP API
        return string(abi.encodePacked(
            "https://xaap.scriptmasterlabs.com/api/v1/nft/", _toString(tokenId)
        ));
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 n = v; uint256 len;
        while (n > 0) { len++; n /= 10; }
        bytes memory s = new bytes(len);
        while (v > 0) { s[--len] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(s);
    }
}
