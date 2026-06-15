// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title xMITLoyalty
 * @notice Achievement badges as soulbound ERC1155 tokens.
 *         Each badge type is a unique token ID. Non-transferable.
 */
contract xMITLoyalty is ERC1155, Ownable {
    // Badge IDs
    uint256 public constant BADGE_TRIPLE_THREAT   = 1;  // Top 100 in all 3 modules
    uint256 public constant BADGE_NOSTRADAMUS     = 2;  // 10 correct predictions in a row
    uint256 public constant BADGE_WHISPERER       = 3;  // First to detect 5 institutional moves
    uint256 public constant BADGE_DRAGON_SLAYER   = 4;  // Short thesis led to 50%+ collapse
    uint256 public constant BADGE_GOVERNANCE_ACE  = 5;  // 90%+ governance vote accuracy
    uint256 public constant BADGE_FLOW_MASTER     = 6;  // 85%+ institutional flow accuracy
    uint256 public constant BADGE_EARLY_ADOPTER   = 100; // First 1000 analysts

    mapping(address => uint256) public referrerOf;
    mapping(address => uint256) public referralCount;
    mapping(address => uint256) public referralFeesEarnedMicro;

    address public coreContract;

    uint256 public constant REFERRAL_FEE_BPS = 1000; // 10% of protocol fee

    event BadgeAwarded(address indexed analyst, uint256 badgeId, string badgeName);
    event ReferralRegistered(address indexed referee, address indexed referrer);
    event ReferralFeeEarned(address indexed referrer, uint256 feeMicro);

    constructor(address _owner) ERC1155("") Ownable(_owner) {}

    modifier onlyCore() {
        require(msg.sender == coreContract || msg.sender == owner(), "Not authorized");
        _;
    }

    function setCoreContract(address _core) external onlyOwner {
        coreContract = _core;
    }

    function awardBadge(address analyst, uint256 badgeId) external onlyCore {
        require(balanceOf(analyst, badgeId) == 0, "Badge already held");
        _mint(analyst, badgeId, 1, "");

        string memory name;
        if (badgeId == BADGE_TRIPLE_THREAT)  name = "Triple Threat";
        else if (badgeId == BADGE_NOSTRADAMUS)    name = "Nostradamus";
        else if (badgeId == BADGE_WHISPERER)      name = "Whisperer";
        else if (badgeId == BADGE_DRAGON_SLAYER)  name = "Dragon Slayer";
        else if (badgeId == BADGE_GOVERNANCE_ACE) name = "Governance Ace";
        else if (badgeId == BADGE_FLOW_MASTER)    name = "Flow Master";
        else if (badgeId == BADGE_EARLY_ADOPTER)  name = "Early Adopter";
        else name = "Achievement";

        emit BadgeAwarded(analyst, badgeId, name);
    }

    function registerReferral(address referee, address referrer) external onlyCore {
        require(referrerOf[referee] == address(0), "Referral already set");
        require(referee != referrer, "Cannot self-refer");
        referrerOf[referee] = referrer;
        referralCount[referrer]++;
        emit ReferralRegistered(referee, referrer);
    }

    function creditReferralFee(address referee, uint256 protocolFeeMicro) external onlyCore {
        address referrer = referrerOf[referee];
        if (referrer == address(0)) return;
        uint256 fee = (protocolFeeMicro * REFERRAL_FEE_BPS) / 10000;
        referralFeesEarnedMicro[referrer] += fee;
        emit ReferralFeeEarned(referrer, fee);
    }

    // Soulbound: block all transfers except mints
    function safeTransferFrom(
        address, address, uint256, uint256, bytes memory
    ) public pure override {
        revert("Soulbound: non-transferable");
    }

    function safeBatchTransferFrom(
        address, address, uint256[] memory, uint256[] memory, bytes memory
    ) public pure override {
        revert("Soulbound: non-transferable");
    }
}
