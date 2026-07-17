// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/// @title xAAPLoyalty — Soulbound achievement badges + early access seals.
/// @notice ERC-1155 with transfer lock. Badge IDs are deterministic uint256 hashes.
///         First 1,000 registrants receive an xAAP Seal (tokenId 0) — permanent premium.
contract xAAPLoyalty is ERC1155, Ownable2Step {

    // Soulbound: reject all transfers
    function safeTransferFrom(address, address, uint256, uint256, bytes memory) public pure override {
        revert("SOULBOUND");
    }
    function safeBatchTransferFrom(address, address, uint256[] memory, uint256[] memory, bytes memory) public pure override {
        revert("SOULBOUND");
    }

    uint256 public constant SEAL_TOKEN_ID = 0;   // xAAP Seal (early access)
    uint256 public sealsMinted;
    uint256 public constant MAX_SEALS = 1_000;

    address public coreContract;

    // Badge metadata stored as bytes32 hash → IPFS CID pointer
    mapping(uint256 => string) public badgeUri;

    event BadgeAwarded(address indexed to, uint256 indexed badgeId, string badgeName);
    event SealMinted(address indexed to, uint256 sealNumber);

    // Known badge IDs (keccak256 of badge name string, truncated to uint256)
    uint256 public constant BADGE_FIRST_BLOOD       = uint256(keccak256("FIRST_BLOOD"));
    uint256 public constant BADGE_ENRONS_REVENGE     = uint256(keccak256("ENRONS_REVENGE"));
    uint256 public constant BADGE_GHOST_HUNTER       = uint256(keccak256("GHOST_HUNTER"));
    uint256 public constant BADGE_SATELLITE_SLEUTH   = uint256(keccak256("SATELLITE_SLEUTH"));
    uint256 public constant BADGE_WAYBACK_WARRIOR    = uint256(keccak256("WAYBACK_WARRIOR"));
    uint256 public constant BADGE_CENTURION          = uint256(keccak256("CENTURION"));
    uint256 public constant BADGE_PROPHET            = uint256(keccak256("PROPHET"));
    uint256 public constant BADGE_IRON_JUROR         = uint256(keccak256("IRON_JUROR"));

    constructor() ERC1155("https://xaap.scriptmasterlabs.com/api/v1/nft/badge/{id}") Ownable(msg.sender) {}

    /// @notice Award an achievement badge. Only callable by core or owner.
    function awardBadge(address to, uint256 badgeId, string calldata badgeName) external {
        require(msg.sender == coreContract || msg.sender == owner(), "unauthorized");
        // Idempotent — already awarded is a no-op
        if (balanceOf(to, badgeId) == 0) {
            _mint(to, badgeId, 1, "");
            emit BadgeAwarded(to, badgeId, badgeName);
        }
    }

    /// @notice Mint an xAAP Seal for early adopters (first 1,000).
    function mintSeal(address to) external {
        require(msg.sender == coreContract || msg.sender == owner(), "unauthorized");
        require(sealsMinted < MAX_SEALS, "seals exhausted");
        require(balanceOf(to, SEAL_TOKEN_ID) == 0, "already has seal");
        uint256 num = ++sealsMinted;
        _mint(to, SEAL_TOKEN_ID, 1, "");
        emit SealMinted(to, num);
    }

    function setCoreContract(address _core) external onlyOwner { coreContract = _core; }

    function uri(uint256 tokenId) public view override returns (string memory) {
        if (bytes(badgeUri[tokenId]).length > 0) return badgeUri[tokenId];
        return super.uri(tokenId);
    }

    function setBadgeUri(uint256 tokenId, string calldata _uri) external onlyOwner {
        badgeUri[tokenId] = _uri;
    }
}
