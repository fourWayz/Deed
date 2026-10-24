// node --experimental-strip-types --test lib/priceSource.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { priceSourceInRange } from "./priceSource.ts";

const E18 = 10n ** 18n;

test("equal prices are in range", () => {
  assert.equal(priceSourceInRange(80_000n * E18, 80_000n * E18, 1000n), true);
});

test("the edge of the limit is in range, one wei past it is not", () => {
  const oracle = 80_000n * E18;
  const edge = oracle + (oracle * 1000n) / 10_000n; // exactly +10%
  assert.equal(priceSourceInRange(oracle, edge, 1000n), true);
  assert.equal(priceSourceInRange(oracle, edge + 1n, 1000n), false);
});

test("it works in both directions", () => {
  const oracle = 80_000n * E18;
  assert.equal(priceSourceInRange(oracle, 70_000n * E18, 1000n), false); // 12.5% under
  assert.equal(priceSourceInRange(oracle, 90_000n * E18, 1000n), false); // 12.5% over
  assert.equal(priceSourceInRange(oracle, 78_686n * E18, 1000n), true); // the testnet pool today, 1.6% under
});

test("a tighter limit rejects what a wider one accepts", () => {
  const oracle = 80_000n * E18;
  const spot = 78_000n * E18; // 2.5% under
  assert.equal(priceSourceInRange(oracle, spot, 1000n), true);
  assert.equal(priceSourceInRange(oracle, spot, 200n), false);
});
