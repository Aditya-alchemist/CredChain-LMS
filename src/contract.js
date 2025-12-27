export const CONTRACT_ADDRESS = "0x8CB1654cd2a85f572F80A360B78eB24743C0F356";

export const CONTRACT_ABI = [
  "function owner() view returns (address)",
  "function isIssuer(address) view returns (bool)",
  "function setIssuer(address issuer, bool allowed)",
  "function nextTokenId() view returns (uint256)",

  "function mintCredential(address learner, bytes32 credHash, string uri) returns (uint256)",
  "function revoke(uint256 tokenId)",
  "function isValid(uint256 tokenId) view returns (bool)",

  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",

  "function credentialOf(uint256 tokenId) view returns (address issuer, bytes32 credHash, uint64 issuedAt, bool revoked)",

  "event CredentialMinted(uint256 indexed tokenId, address indexed issuer, address indexed learner, bytes32 credHash, string uri)",
  "event CredentialRevoked(uint256 indexed tokenId, address indexed issuer)",
  "event IssuerUpdated(address indexed issuer, bool allowed)"
];
