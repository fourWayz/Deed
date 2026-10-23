"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import type { PublicClient } from "viem";
import { ADDR, auctionAbi, factoryAbi, marketAbi, vaultAbi, MCR } from "@/lib/config";
import { ensureAllowance, snapshotHash } from "@/lib/actions";
import { getHints } from "@/lib/hints";
import { auctionPriceAt, type Position } from "@/lib/positions";
import { fmtBTC, fmtMUSD, fmtPct, parseAmount } from "@/lib/format";
import { useTx } from "@/lib/useTx";
import { TxButton } from "./ui";

function useWallet() {
  const { address } = useAccount();
  const client = usePublicClient() as PublicClient;
  const { writeContractAsync } = useWriteContract();
  return { address, client, write: writeContractAsync };
}

// --- open a position ---

export function CreatePosition({ price, onDone }: { price: bigint | null; onDone: () => void }) {
  const { address, client, write } = useWallet();
  const [btc, setBtc] = useState("0.1");
  const [debt, setDebt] = useState("2000");
  const { state, run } = useTx(onDone);

  const coll = parseAmount(btc);
  const borrow = parseAmount(debt);
  // borrowing fee is 0.1% and 200 MUSD gas compensation is added on top
  const total = borrow ? borrow + borrow / 1000n + 200n * 10n ** 18n : null;
  const icr = price && coll && total ? (coll * price) / total : null;
  const tooLow = icr !== null && icr < MCR;
  const belowMin = borrow !== null && borrow < 1800n * 10n ** 18n;

  return (
    <div className="glass stack">
      <h2>Open a position</h2>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <label>Collateral (BTC)</label>
          <input value={btc} onChange={(e) => setBtc(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label>Borrow (MUSD, min 1,800)</label>
          <input value={debt} onChange={(e) => setDebt(e.target.value)} inputMode="decimal" />
        </div>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        Resulting ICR <b>{fmtPct(icr)}</b>
        {tooLow && <span style={{ color: "var(--bad)" }}> — under 110%, this would revert</span>}
        {belowMin && <span style={{ color: "var(--bad)" }}> — under the minimum debt</span>}
      </div>
      <TxButton
        label="Open position"
        state={state}
        disabled={!address || !coll || !borrow || tooLow || belowMin}
        onClick={() =>
          run(async () => {
            const hints = await getHints(client, coll!, total!);
            return write({
              address: ADDR.factory,
              abi: factoryAbi,
              functionName: "createPosition",
              args: [borrow!, hints.upper, hints.lower],
              value: coll!,
            });
          })
        }
      />
    </div>
  );
}

// --- buy a listing ---

export function BuyButton({ p, onDone }: { p: Position; onDone: () => void }) {
  const { address, client, write } = useWallet();
  const { state, run } = useTx(onDone);
  const l = p.listing!;
  const expired = BigInt(Math.floor(Date.now() / 1000)) > l.expiry;
  return (
    <TxButton
      label={`Buy for ${fmtMUSD(l.price)}`}
      state={state}
      disabled={!address || expired || l.seller === address}
      onClick={() =>
        run(async (wait) => {
          await ensureAllowance(client, (a) => write(a), address!, ADDR.market, l.price, wait);
          // the hash is what this buyer looked at, the contract reverts if the position moved
          return write({
            address: ADDR.market,
            abi: marketAbi,
            functionName: "buy",
            args: [p.id, snapshotHash(p, l.minICR), l.price],
          });
        })
      }
    />
  );
}

// --- win a rescue auction ---

export function BidButton({ p, safeICR, onDone }: { p: Position; safeICR: bigint; onDone: () => void }) {
  const { address, client, write } = useWallet();
  const { state, run } = useTx(onDone);
  const a = p.auction!;
  return (
    <TxButton
      label="Bid at current price"
      state={state}
      disabled={!address || a.seller === address}
      onClick={() =>
        run(async (wait) => {
          const price = auctionPriceAt(a, Math.floor(Date.now() / 1000));
          const needed = await client.readContract({
            address: ADDR.auction,
            abi: auctionAbi,
            functionName: "requiredTopUp",
            args: [p.id],
          });
          // 1% extra so a small price move between quote and mining does not revert
          const topUp = needed + needed / 100n + 1n;
          const hints = await getHints(client, p.liveColl + topUp, p.principal);
          await ensureAllowance(client, (x) => write(x), address!, ADDR.auction, price, wait);
          return write({
            address: ADDR.auction,
            abi: auctionAbi,
            functionName: "bid",
            args: [p.id, price, hints.upper, hints.lower],
            value: topUp,
          });
        })
      }
    />
  );
}

export function StartRescueButton({ p, onDone }: { p: Position; onDone: () => void }) {
  const { address, write } = useWallet();
  const { state, run } = useTx(onDone);
  return (
    <TxButton
      label="Start rescue auction"
      variant="ghost"
      state={state}
      disabled={!address}
      onClick={() =>
        run(() => write({ address: ADDR.auction, abi: auctionAbi, functionName: "startRescue", args: [p.id] }))
      }
    />
  );
}

// --- manage a position you hold ---

export function ManagePanel({ p, safeICR, onDone }: { p: Position; safeICR: bigint; onDone: () => void }) {
  const { address, client, write } = useWallet();
  const [amount, setAmount] = useState("");
  const [listPrice, setListPrice] = useState("");
  const [minICR, setMinICR] = useState("150");
  const [days, setDays] = useState("3");
  const [floor, setFloor] = useState("50");
  const [hours, setHours] = useState("12");

  const add = useTx(onDone);
  const withdraw = useTx(onDone);
  const repay = useTx(onDone);
  const close = useTx(onDone);
  const list = useTx(onDone);
  const auction = useTx(onDone);
  const claim = useTx(onDone);

  const amt = parseAmount(amount);
  const locked = p.lockedBy !== "0x0000000000000000000000000000000000000000";
  const mine = address && p.owner.toLowerCase() === address.toLowerCase();
  if (!mine) return <div className="glass muted">Connect the wallet that holds this Deed to manage it.</div>;
  if (p.status !== 1) {
    return (
      <div className="glass stack">
        <h2>Closed or liquidated</h2>
        <div className="muted">If this position was liquidated, claim any surplus collateral.</div>
        <TxButton
          label="Claim surplus"
          variant="ghost"
          state={claim.state}
          onClick={() => claim.run(() => write({ address: p.vault, abi: vaultAbi, functionName: "claimSurplus" }))}
        />
      </div>
    );
  }

  const vaultCall = async (fn: "addCollateral" | "withdraw") => {
    if (!amt) throw new Error("Enter an amount");
    if (fn === "addCollateral") {
      const hints = await getHints(client, p.coll + amt, p.principal);
      return write({
        address: p.vault,
        abi: vaultAbi,
        functionName: "addCollateral",
        args: [hints.upper, hints.lower],
        value: amt,
      });
    }
    const hints = await getHints(client, p.coll - amt, p.principal);
    return write({ address: p.vault, abi: vaultAbi, functionName: "withdraw", args: [amt, hints.upper, hints.lower] });
  };

  return (
    <div className="stack">
      {locked && (
        <div className="notice">
          This Deed is locked by {p.listing ? "a market listing" : "a rescue auction"}. The vault is frozen until it ends.
        </div>
      )}

      <div className="glass stack">
        <h2>Manage</h2>
        <div>
          <label>Amount (BTC for collateral, MUSD for repay)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" />
        </div>
        <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          <TxButton
            label="Add collateral"
            state={add.state}
            disabled={locked || !amt}
            onClick={() => add.run(() => vaultCall("addCollateral"))}
          />
          <TxButton
            label="Withdraw collateral"
            variant="ghost"
            state={withdraw.state}
            disabled={locked || !amt}
            onClick={() => withdraw.run(() => vaultCall("withdraw"))}
          />
          <TxButton
            label="Repay MUSD"
            variant="ghost"
            state={repay.state}
            disabled={locked || !amt}
            onClick={() =>
              repay.run(async (wait) => {
                const hints = await getHints(client, p.coll, p.principal - amt!);
                await ensureAllowance(client, (x) => write(x), address!, p.vault, amt!, wait);
                return write({
                  address: p.vault,
                  abi: vaultAbi,
                  functionName: "repay",
                  args: [amt!, hints.upper, hints.lower],
                });
              })
            }
          />
          <TxButton
            label="Close position"
            variant="danger"
            state={close.state}
            disabled={locked}
            onClick={() =>
              close.run(async (wait) => {
                // repay everything except the 200 MUSD gas compensation, plus a little for interest
                const need = p.debt - 200n * 10n ** 18n;
                await ensureAllowance(client, (x) => write(x), address!, p.vault, need + need / 100n, wait);
                return write({ address: p.vault, abi: vaultAbi, functionName: "close" });
              })
            }
          />
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          Closing needs {fmtMUSD(p.debt - 200n * 10n ** 18n)} in your wallet. Collateral now {fmtBTC(p.liveColl)}.
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <div className="glass stack">
          <h2>Sell at a fixed price</h2>
          <div>
            <label>Price (MUSD)</label>
            <input value={listPrice} onChange={(e) => setListPrice(e.target.value)} inputMode="decimal" />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Promised min ICR (%)</label>
              <input value={minICR} onChange={(e) => setMinICR(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <label>Listing length (days)</label>
              <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="decimal" />
            </div>
          </div>
          {p.listing ? (
            <TxButton
              label="Cancel listing"
              variant="ghost"
              state={list.state}
              onClick={() => list.run(() => write({ address: ADDR.market, abi: marketAbi, functionName: "cancel", args: [p.id] }))}
            />
          ) : (
            <TxButton
              label="List for sale"
              state={list.state}
              disabled={locked || !parseAmount(listPrice)}
              onClick={() =>
                list.run(() => {
                  const expiry = BigInt(Math.floor(Date.now() / 1000) + Math.round(Number(days) * 86400));
                  const min = BigInt(Math.round(Number(minICR) * 100)) * 10n ** 14n;
                  return write({
                    address: ADDR.market,
                    abi: marketAbi,
                    functionName: "list",
                    args: [p.id, parseAmount(listPrice)!, expiry, min],
                  });
                })
              }
            />
          )}
          <div className="muted" style={{ fontSize: 12.5 }}>
            Listing freezes the vault. Buyers are protected by a snapshot of the position.
          </div>
        </div>

        <div className="glass stack">
          <h2>Rescue auction</h2>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Floor (% of equity)</label>
              <input value={floor} onChange={(e) => setFloor(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <label>Duration (hours)</label>
              <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" />
            </div>
          </div>
          {p.auction ? (
            <TxButton
              label="Cancel auction"
              variant="ghost"
              state={auction.state}
              onClick={() => auction.run(() => write({ address: ADDR.auction, abi: auctionAbi, functionName: "cancel", args: [p.id] }))}
            />
          ) : (
            <TxButton
              label="Start auction"
              state={auction.state}
              disabled={locked}
              onClick={() =>
                auction.run(() =>
                  write({
                    address: ADDR.auction,
                    abi: auctionAbi,
                    functionName: "start",
                    args: [p.id, BigInt(Math.round(Number(floor) * 100)), BigInt(Math.round(Number(hours) * 3600))],
                  }),
                )
              }
            />
          )}
          <div className="muted" style={{ fontSize: 12.5 }}>
            The winner pays MUSD to you and tops the position up to {fmtPct(safeICR)} or more.
          </div>
        </div>
      </div>
    </div>
  );
}
