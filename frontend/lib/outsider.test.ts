// node --experimental-strip-types --test lib/outsider.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { anyOutside } from "./outsider.ts";

const A = "0x522bc0c3919ff823173ca4145feece905f772ffe";
const B = "0xef05acadf5d3ff7e8e5f0be2515f2be351e225a6";
const C = "0x1111111111111111111111111111111111111111";

test("only team wallets, nobody outside", () => {
  assert.equal(anyOutside([A, B, A], [A, B]), false);
});
test("a wallet that is not on the list counts, whatever the letter case", () => {
  assert.equal(anyOutside([A, C], [A, B]), true);
  assert.equal(anyOutside([A.toUpperCase().replace("0X", "0x")], [A]), false);
});
test("no team list configured: never claim someone is outside", () => {
  assert.equal(anyOutside([C], []), false);
});
test("no activity at all: nobody outside", () => {
  assert.equal(anyOutside([], [A]), false);
});
