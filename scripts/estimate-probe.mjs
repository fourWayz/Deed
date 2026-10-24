// Checks whether eth_estimateGas on the Mezo testnet RPC returns a too-low value right after a state change.
// Sets the taker's MUSD allowance to the market back and forth, then estimates market.buy straight away.
//   node --env-file=.env scripts/estimate-probe.mjs
import fs from "node:fs";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const dep = JSON.parse(fs.readFileSync(new URL("../deployments.json", import.meta.url)));
const RPC = process.env.MEZO_TESTNET_RPC;
const chain = { id: 31611, name: "Mezo Testnet", nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const transport = http(RPC, { retryCount: 5, retryDelay: 1500 });
const pub = createPublicClient({ chain, transport });
const k = process.env.SELLER_KEY;
const account = privateKeyToAccount(k.startsWith("0x") ? k : `0x${k}`);
const wallet = createWalletClient({ account, chain, transport });
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)"]);
const market = parseAbi(["function buy(uint256,bytes32,uint256)", "function listings(uint256) view returns (address,uint64,uint256,uint256,bytes32)"]);

const listing = await pub.readContract({ address: dep.market, abi: market, functionName: "listings", args: [1n] });
const snapshot = listing[4];
const price = listing[2];
const data = encodeFunctionData({ abi: market, functionName: "buy", args: [1n, snapshot, price] });
const est = () => pub.estimateGas({ account, to: dep.market, data }).then((g) => g.toString(), (e) => `error: ${e.shortMessage ?? e.message}`.slice(0, 80));

console.log("estimate before:", await est());
for (let i = 0; i < 4; i++) {
  const amount = i % 2 === 0 ? 0n : price;
  const h = await wallet.sendTransaction({
    to: dep.musd,
    data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [dep.market, amount] }),
    gas: 100000n,
  });
  await pub.waitForTransactionReceipt({ hash: h });
  const t0 = Date.now();
  const samples = [];
  for (let j = 0; j < 4; j++) {
    samples.push(await est());
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`after approve(${amount === 0n ? "0" : "price"}) [+${Date.now() - t0}ms]:`, samples.join(" | "));
}
console.log("estimate after:", await est());
