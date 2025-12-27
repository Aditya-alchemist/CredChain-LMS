// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title CredentialNFT - ERC721 credentials for LMS
/// @notice Each credential is an NFT (unique, non-fungible).
///         Token owner = learner wallet (decentralized learner ID).
///         Issuers (institution/instructors) mint credentials.
///         Stores only a hash + optional URI pointer (IPFS/HTTPS).
contract CredentialNFT is ERC721, Ownable {
    struct CredentialMeta {
        address issuer;
        bytes32 credHash;   
        uint64 issuedAt;
        bool revoked;       
    }

    uint256 public nextTokenId = 0;

    mapping(address => bool) public isIssuer;
    mapping(uint256 => CredentialMeta) public credentialOf;
    mapping(uint256 => string) private _tokenURIs;

    event IssuerUpdated(address indexed issuer, bool allowed);
    event CredentialMinted(
        uint256 indexed tokenId,
        address indexed issuer,
        address indexed learner,
        bytes32 credHash,
        string uri
    );
    event CredentialRevoked(uint256 indexed tokenId, address indexed issuer);

    error NotIssuer();
    error NotOriginalIssuer();
    error Revoked();

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) Ownable(msg.sender) {
        isIssuer[msg.sender] = true;
        emit IssuerUpdated(msg.sender, true);
    }

    modifier onlyIssuer() {
        if (!isIssuer[msg.sender]) revert NotIssuer();
        _;
    }

    function setIssuer(address issuer, bool allowed) external onlyOwner {
        isIssuer[issuer] = allowed;
        emit IssuerUpdated(issuer, allowed);
    }

    function mintCredential(
        address learner,
        bytes32 credHash,
        string calldata uri
    ) external onlyIssuer returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(learner, tokenId);

        credentialOf[tokenId] = CredentialMeta({
            issuer: msg.sender,
            credHash: credHash,
            issuedAt: uint64(block.timestamp),
            revoked: false
        });

        _tokenURIs[tokenId] = uri;

        emit CredentialMinted(tokenId, msg.sender, learner, credHash, uri);
    }

    function revoke(uint256 tokenId) external onlyIssuer {
        if (credentialOf[tokenId].issuer != msg.sender) revert NotOriginalIssuer();
        credentialOf[tokenId].revoked = true;
        emit CredentialRevoked(tokenId, msg.sender);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _tokenURIs[tokenId];
    }

    function isValid(uint256 tokenId) external view returns (bool) {
        // will revert if not minted; catch in frontend
        _ownerOf(tokenId);
        return !credentialOf[tokenId].revoked;
    }

  
}
