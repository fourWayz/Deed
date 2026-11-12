import { parseAbi, type Address } from "viem";

const zero = "0x0000000000000000000000000000000000000000" as Address;
const env = (v: string | undefined) => (v && v.startsWith("0x") ? (v as Address) : zero);

// Deed contracts, filled in from the deploy output
export const ADDR = {
  deed: env(process.env.NEXT_PUBLIC_DEED_NFT),
  factory: env(process.env.NEXT_PUBLIC_FACTORY),
  market: env(process.env.NEXT_PUBLIC_MARKET),
  auction: env(process.env.NEXT_PUBLIC_AUCTION),
  lens: env(process.env.NEXT_PUBLIC_LENS),
  // Mezo testnet, checked on chain (docs/mezo-notes.md)
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as Address,
  troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0" as Address,
  borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5" as Address,
  hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6" as Address,
  sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA" as Address,
};

export const ZERO = zero;
export const deployed =
  ADDR.deed !== zero && ADDR.factory !== zero && ADDR.market !== zero && ADDR.auction !== zero && ADDR.lens !== zero;
export const EXPLORER = "https://explorer.test.mezo.org";
export const FAUCET = "https://faucet.test.mezo.org/";
export const GAS_COMP = 200n * 10n ** 18n;
export const MCR = 11n * 10n ** 17n;

// mp4 file or Vimeo player url for the landing page, empty shows the placeholder
export const VIDEO_URL = process.env.NEXT_PUBLIC_DEMO_VIDEO ?? "";
// block this deployment was created at, the chain scan behind the activity page starts here (RPC allows 10,000 blocks per request)
export const START_BLOCK = BigInt(process.env.NEXT_PUBLIC_START_BLOCK ?? "0");
// name the indexer gives the deployment this app is built for, every other version it reports is an earlier deployment
export const CURRENT_VERSION = process.env.NEXT_PUBLIC_DEPLOYMENT_VERSION ?? "v3";
// base url of the indexer api. Empty or unreachable means the activity page counts events from the chain itself.
export const INDEXER_URL = (process.env.NEXT_PUBLIC_INDEXER_URL ?? "").replace(/\/+$/, "");

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
  "function surplus() view returns (uint256)",
  "function borrow(uint256 amount, address upperHint, address lowerHint)",
  "function refinance(address upperHint, address lowerHint)",
  "error NotController()",
  "error RecoveryModeActive()",
  "error NothingToClaim()",
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
  "function feeBps() view returns (uint256)",
  "function feeFor(uint256 price) view returns (uint256)",
  "function treasury() view returns (address)",
  "error BadParams()",
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
  "function spotSource() view returns (address)",
  "function maxDeviationBps() view returns (uint256)",
  "function MIN_FLOOR_BPS() view returns (uint256)",
  "function safeICR() view returns (uint256)",
  "function start(uint256 tokenId, uint256 floorBps, uint64 duration)",
  "function startRescue(uint256 tokenId)",
  "function topUp(uint256 tokenId, address upperHint, address lowerHint) payable",
  "function cancel(uint256 tokenId)",
  "function end(uint256 tokenId)",
  "function bid(uint256 tokenId, uint256 maxPrice, address upperHint, address lowerHint) payable",
  "function claim()",
  "function feeBps() view returns (uint256)",
  "function feeFor(uint256 price) view returns (uint256)",
  "error BadParams()",
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

export const troveManagerAbi = parseAbi([
  "function getEntireDebtAndColl(address borrower) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingColl, uint256 pendingPrincipal, uint256 pendingInterest)",
  "function getTroveStatus(address borrower) view returns (uint256)",
]);

export const lensAbi = parseAbi([
  "function position(uint256 tokenId) view returns ((address vault, address holder, address lockedBy, uint8 status, uint256 collateral, uint256 principal, uint256 interest, uint256 debt, uint256 icr, uint16 rate, uint256 collateralValue, uint256 equity, uint256 surplus, uint256 price, uint256 tcr, bool recoveryMode, bool priceStale, bool canClose, bool canWithdraw, bool canBorrow, bool canRefinance))",
  "function system() view returns (uint256 price, uint256 tcr, bool recoveryMode, bool priceStale)",
  "error UnknownDeed()",
]);

export const eventsAbi = parseAbi([
  "event PositionCreated(uint256 indexed tokenId, address indexed vault, address indexed owner, uint256 collateral, uint256 debt)",
  "event Listed(uint256 indexed tokenId, address indexed seller, uint256 price, uint64 expiry, uint256 minICR, bytes32 snapshot)",
  "event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee)",
  "event Started(uint256 indexed tokenId, address indexed seller, bool byOwner, uint256 startPrice, uint256 floorPrice, uint64 duration)",
  "event Won(uint256 indexed tokenId, address indexed seller, address indexed winner, uint256 price, uint256 fee, uint256 topUp)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const spotAbi = parseAbi(["function spotPrice() view returns (uint256)"]);

export const hintHelpersAbi = parseAbi([
  "function getApproxHint(uint256 cr, uint256 numTrials, uint256 inputRandomSeed) view returns (address hintAddress, uint256 diff, uint256 latestRandomSeed)",
  "function computeNominalCR(uint256 coll, uint256 debt) pure returns (uint256)",
]);

export const sortedTrovesAbi = parseAbi([
  "function findInsertPosition(uint256 nicr, address prevId, address nextId) view returns (address, address)",
  "function getSize() view returns (uint256)",
]);
