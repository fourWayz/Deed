import { parseAbi, type Address } from "viem";

const zero = "0x0000000000000000000000000000000000000000" as Address;
const env = (v: string | undefined) => (v && v.startsWith("0x") ? (v as Address) : zero);

// Deed contracts, filled in from the deploy output
export const ADDR = {
  deed: env(process.env.NEXT_PUBLIC_DEED_NFT),
  factory: env(process.env.NEXT_PUBLIC_FACTORY),
  market: env(process.env.NEXT_PUBLIC_MARKET),
  auction: env(process.env.NEXT_PUBLIC_AUCTION),
  // Mezo testnet, checked on chain (docs/mezo-notes.md)
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as Address,
  priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366" as Address,
  hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6" as Address,
  sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA" as Address,
};

export const ZERO = zero;
export const deployed = ADDR.deed !== zero && ADDR.factory !== zero && ADDR.market !== zero && ADDR.auction !== zero;
export const EXPLORER = "https://explorer.test.mezo.org";
export const GAS_COMP = 200n * 10n ** 18n;
export const MCR = 11n * 10n ** 17n;

export const deedAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function lockedBy(uint256) view returns (address)",
  "error Locked()",
  "error NotVenue()",
  "error NotLocker()",
  "error AlreadyLocked()",
]);

export const factoryAbi = parseAbi([
  "function createPosition(uint256 debtAmount, address upperHint, address lowerHint) payable returns (uint256 tokenId, address vault)",
  "function vaultOf(uint256) view returns (address)",
]);

export const vaultAbi = parseAbi([
  "function troveState() view returns (uint8 status, uint256 coll, uint256 principal, uint16 rate)",
  "function liveState() view returns (uint256 coll, uint256 debt)",
  "function closed() view returns (bool)",
  "function addCollateral(address upperHint, address lowerHint) payable",
  "function repay(uint256 amount, address upperHint, address lowerHint)",
  "function withdraw(uint256 amount, address upperHint, address lowerHint)",
  "function close()",
  "function claimSurplus()",
  "error NotController()",
  "error NotOpen()",
  "error AlreadyOpened()",
  "error Reentrancy()",
  "error TransferFailed()",
]);

export const marketAbi = parseAbi([
  "function listings(uint256) view returns (address seller, uint64 expiry, uint256 price, uint256 minICR, bytes32 snapshot)",
  "function claimable(address) view returns (uint256)",
  "function list(uint256 tokenId, uint256 price, uint64 expiry, uint256 minICR)",
  "function cancel(uint256 tokenId)",
  "function buy(uint256 tokenId, bytes32 expectedSnapshot, uint256 maxPrice)",
  "function claim()",
  "error NotOwner()",
  "error NotListed()",
  "error AlreadyListed()",
  "error BadPrice()",
  "error BadExpiry()",
  "error BadMinICR()",
  "error NotActive()",
  "error NotSeller()",
  "error Expired()",
  "error NotExpired()",
  "error SnapshotMismatch()",
  "error PriceTooHigh()",
  "error IcrTooLow(uint256 icr, uint256 minICR)",
  "error NothingToClaim()",
  "error TransferFailed()",
  "error Reentrancy()",
]);

export const auctionAbi = parseAbi([
  "function auctions(uint256) view returns (address seller, bool byOwner, uint64 start, uint64 duration, uint256 startPrice, uint256 floorPrice)",
  "function claimable(address) view returns (uint256)",
  "function currentPrice(uint256) view returns (uint256)",
  "function requiredTopUp(uint256) view returns (uint256)",
  "function rescueICR() view returns (uint256)",
  "function safeICR() view returns (uint256)",
  "function start(uint256 tokenId, uint256 floorBps, uint64 duration)",
  "function startRescue(uint256 tokenId)",
  "function topUp(uint256 tokenId, address upperHint, address lowerHint) payable",
  "function cancel(uint256 tokenId)",
  "function end(uint256 tokenId)",
  "function bid(uint256 tokenId, uint256 maxPrice, address upperHint, address lowerHint) payable",
  "function claim()",
  "error NotOwner()",
  "error NotSeller()",
  "error NotRunning()",
  "error AlreadyRunning()",
  "error NotActive()",
  "error NoEquity()",
  "error BadParams()",
  "error Healthy(uint256 icr, uint256 rescueICR)",
  "error NotAllowed()",
  "error NotExpired()",
  "error Expired()",
  "error PriceTooHigh(uint256 price)",
  "error StillRisky(uint256 icr, uint256 safeICR)",
  "error SpotDeviation(uint256 oracle, uint256 spot)",
  "error NothingToClaim()",
  "error TransferFailed()",
  "error Reentrancy()",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const priceFeedAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);

export const hintHelpersAbi = parseAbi([
  "function getApproxHint(uint256 cr, uint256 numTrials, uint256 inputRandomSeed) view returns (address hintAddress, uint256 diff, uint256 latestRandomSeed)",
  "function computeNominalCR(uint256 coll, uint256 debt) pure returns (uint256)",
]);

export const sortedTrovesAbi = parseAbi([
  "function findInsertPosition(uint256 nicr, address prevId, address nextId) view returns (address, address)",
  "function getSize() view returns (uint256)",
]);
