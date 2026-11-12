// One-off: the two e2e wallets are out of test BTC, so close two superseded v2 positions and claim the surplus of a
// third that a testnet redemption closed. Only touches positions the wallets own.
// node --env-file=<env file> scripts/recycle-v2.mjs
import fs from "node:fs";
import { createPublicClient, createWalletClient, encodeFunctionData, formatUnits, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.MEZO_TESTNET_RPC;
const key = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const chain = { id: 31611, name: "Mezo Testnet", nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const transport = http(RPC, { retryCount: 6, retryDelay: 2000 });
const pub = createPublicClient({ chain, transport });
const seller = createWalletClient({ account: privateKeyToAccount(key(process.env.SELLER_KEY)), chain, transport });
const buyer = createWalletClient({ account: privateKeyToAccount(key(process.env.BUYER_KEY)), chain, transport });
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const TM = "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0";
const v2 = {
  1: "0xb4C2061462280FD6e12418c0651938186618EDD2",
  2: "0x057FF1301AA405B8e5CDf9693B38C70b6dA3BE92",
  3: "0x68833F0c0e6d3E0B21805627867B86157572C013",
};
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"]);
const vaultAbi = parseAbi(["function close()", "function claimSurplus()"]);
const tm = parseAbi(["function getTroveDebt(address) view returns (uint256)", "function getTroveStatus(address) view returns (uint8)"]);
const e18 = (v) => formatUnits(v, 18);
const log = [];

async function send(w, label, to, abi, fn, args = []) {
  const data = encodeFunctionData({ abi, functionName: fn, args });
  const hash = await w.sendTransaction({ to, data, gas: 900000n });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
  if (r.status !== "success") throw new Error(`${label} reverted ${hash}`);
  log.push({ label, hash, block: Number(r.blockNumber) });
  console.log(`ok ${label} ${hash}`);
}
const bal = (a) => pub.readContract({ address: MUSD, abi: erc20, functionName: "balanceOf", args: [a] });

const main = async () => {
  const sa = seller.account.address;
  const ba = buyer.account.address;
  const need = (await pub.readContract({ address: TM, abi: tm, functionName: "getTroveDebt", args: [v2[1]] })) + (await pub.readContract({ address: TM, abi: tm, functionName: "getTroveDebt", args: [v2[2]] })) - 400n * 10n ** 18n;
  const have = await bal(sa);
  console.log(`seller MUSD ${e18(have)}, needs about ${e18(need)} to close both`);
  if (have < need + 10n ** 18n) await send(buyer, "buyer sends MUSD to seller for the closes", MUSD, erc20, "transfer", [sa, need + 5n * 10n ** 18n - have]);
  for (const id of [1, 2]) {
    const debt = await pub.readContract({ address: TM, abi: tm, functionName: "getTroveDebt", args: [v2[id]] });
    await send(seller, `seller approves MUSD for v2 vault #${id}`, MUSD, erc20, "approve", [v2[id], debt]);
    await send(seller, `seller closes v2 position #${id}`, v2[id], vaultAbi, "close");
  }
  await send(buyer, "buyer claims the surplus of v2 position #3 (closed by a redemption)", v2[3], vaultAbi, "claimSurplus");
  console.log(`seller ${e18(await pub.getBalance({ address: sa }))} BTC ${e18(await bal(sa))} MUSD | buyer ${e18(await pub.getBalance({ address: ba }))} BTC ${e18(await bal(ba))} MUSD`);
  fs.writeFileSync(new URL("../docs/recycle-v2.json", import.meta.url), JSON.stringify(log, null, 2));
};
main().catch((e) => {
  console.error("FAILED:", e.shortMessage ?? e.message);
  process.exit(1);
});
