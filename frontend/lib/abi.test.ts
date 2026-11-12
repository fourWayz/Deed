// Every function, event and error the app uses has to exist in the frozen ABIs under abis/. Run with `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { toFunctionSelector, toEventSelector, type Abi, type AbiItem } from "viem";
import * as cfg from "./config.ts";

const root = new URL("../../abis/", import.meta.url);
const load = (name: string): Abi => JSON.parse(fs.readFileSync(new URL(`${name}.json`, root), "utf8"));

// errors carry no tuples here, so name plus parameter types is a complete signature
const sig = (i: { name?: string; inputs?: readonly { type: string }[] }) => `${i.name}(${(i.inputs ?? []).map((x) => x.type).join(",")})`;
function key(i: AbiItem): string | null {
  if (i.type === "function") return `function ${toFunctionSelector(i)}`;
  if (i.type === "event") return `event ${toEventSelector(i)}`;
  if (i.type === "error") return `error ${sig(i as never)}`;
  return null;
}
const pairs: [string, Abi, string][] = [
  ["deedAbi", cfg.deedAbi, "DeedNFT"],
  ["factoryAbi", cfg.factoryAbi, "DeedFactory"],
  ["vaultAbi", cfg.vaultAbi, "PositionVault"],
  ["marketAbi", cfg.marketAbi, "DeedMarket"],
  ["auctionAbi", cfg.auctionAbi, "RescueAuction"],
  ["lensAbi", cfg.lensAbi, "DeedLens"],
];

for (const [label, abi, file] of pairs) {
  test(`${label} matches abis/${file}.json`, () => {
    const real = new Set((load(file) as AbiItem[]).map(key).filter(Boolean));
    for (const item of abi as AbiItem[]) {
      const k = key(item);
      if (!k) continue;
      assert.ok(real.has(k), `${label}: ${(item as { name?: string }).name} (${k}) is not in abis/${file}.json`);
    }
  });
}

test("event signatures match the venues", () => {
  const market = new Set((load("DeedMarket") as AbiItem[]).map(key));
  const auction = new Set((load("RescueAuction") as AbiItem[]).map(key));
  const factory = new Set((load("DeedFactory") as AbiItem[]).map(key));
  const by = (n: string) => (cfg.eventsAbi as AbiItem[]).find((i) => i.type === "event" && i.name === n)!;
  assert.ok(market.has(key(by("Sold"))!), "Sold");
  assert.ok(market.has(key(by("Listed"))!), "Listed");
  assert.ok(auction.has(key(by("Won"))!), "Won");
  assert.ok(auction.has(key(by("Started"))!), "Started");
  assert.ok(factory.has(key(by("PositionCreated"))!), "PositionCreated");
});
