"use client";

import { useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import type { PublicClient } from "viem";
import { useQuery } from "@tanstack/react-query";
import { ADDR, auctionAbi, factoryAbi, marketAbi, vaultAbi, vaultV3Abi, MCR, VAULT_HAS_BORROW, GAS_COMP } from "@/lib/config";
import { ensureAllowance, snapshotHash } from "@/lib/actions";
import { getHints } from "@/lib/hints";
import { auctionPriceAt, loadSurplus, type Position, type RecoveryInfo } from "@/lib/positions";
import { useFee } from "@/lib/fees";
import { FeeLine } from "./FeeLine";
import { BlockedNote, blockedFor } from "./RecoveryBanner";
import { fmtBTC, fmtMUSD, fmtPct, parseAmount } from "@/lib/format";
import { useTx } from "@/lib/useTx";
import { useSafeWrite } from "@/lib/useSafeWrite";
import { TxButton } from "./ui";

function useWallet() {
  const { address } = useAccount();
  const client = usePublicClient() as PublicClient;
  const write = useSafeWrite();
  return { address, client, write };
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
  const fee = useFee("market", l.price);
  return (
    <div className="stack" style={{ gap: 8 }}>
    <FeeLine price={l.price} quote={fee} role="buyer" />
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
    </div>
  );
}

// --- win a rescue auction ---

export function BidButton({
  p,
  safeICR,
  paused,
  onDone,
}: {
  p: Position;
  safeICR: bigint;
  /** the DEX price is outside the auction's limit, the contract would refuse */
  paused?: boolean;
  onDone: () => void;
}) {
  const { address, client, write } = useWallet();
  const { state, run } = useTx(onDone);
  const a = p.auction!;
  const now = Math.floor(Date.now() / 1000);
  const fee = useFee("auction", auctionPriceAt(a, now));
  return (
    <div className="stack" style={{ gap: 8 }}>
    <FeeLine price={auctionPriceAt(a, now)} quote={fee} role="buyer" />
    <TxButton
      label="Bid at current price"
      state={state}
      disabled={!address || a.seller === address || paused}
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
    </div>
  );
}

export function StartRescueButton({ p, paused, onDone }: { p: Position; paused?: boolean; onDone: () => void }) {
  const { address, write } = useWallet();
  const { state, run } = useTx(onDone);
  return (
    <TxButton
      label="Start rescue auction"
      variant="ghost"
      state={state}
      disabled={!address || paused}
      onClick={() =>
        run(() => write({ address: ADDR.auction, abi: auctionAbi, functionName: "startRescue", args: [p.id] }))
      }
    />
  );
}

// --- manage a position you hold ---

export function ManagePanel({
  p,
  safeICR,
  minFloorBps,
  recovery,
  price,
  onDone,
}: {
  p: Position;
  safeICR: bigint;
  minFloorBps: bigint;
  recovery?: RecoveryInfo;
  price: bigint | null;
  onDone: () => void;
}) {
  const { address, client, write } = useWallet();
  const [amount, setAmount] = useState("");
  const blocked = blockedFor(recovery);
  const minFloorPct = Number(minFloorBps) / 100;
  const [floor, setFloor] = useState(String(minFloorPct));
  const [hours, setHours] = useState("12");

  const add = useTx(onDone);
  const withdraw = useTx(onDone);
  const repay = useTx(onDone);
  const close = useTx(onDone);
  const auction = useTx(onDone);
  const claim = useTx(onDone);
  const surplus = useQuery({ queryKey: ["surplus", p.vault], enabled: p.status !== 1, queryFn: () => loadSurplus(client, p.vault) });

  const amt = parseAmount(amount);
  const floorNum = Number(floor);
  const hoursNum = Number(hours);
  // the contract rejects anything else, so say it here instead of after a failed transaction
  const auctionInputsOk = floorNum >= minFloorPct && floorNum <= 100 && hoursNum >= 1 && hoursNum <= 168;
  const locked = p.lockedBy !== "0x0000000000000000000000000000000000000000";
  const mine = address && p.owner.toLowerCase() === address.toLowerCase();
  if (!mine) return <div className="glass muted">Connect the wallet that holds this Deed to manage it.</div>;
  if (p.status !== 1) {
    const amt0 = surplus.data ?? 0n;
    return (
      <div className="glass stack">
        <h2>{p.status === 3 ? "Liquidated" : "Closed"}</h2>
        <div className="muted">
          {surplus.isLoading
            ? "Checking for surplus collateral…"
            : surplus.error
              ? "Could not check for surplus collateral. Try again in a moment."
              : amt0 > 0n
                ? `Mezo is holding ${fmtBTC(amt0)} of surplus collateral for this vault. Claiming sends it to your wallet.`
                : "There is no surplus collateral waiting for this vault."}
        </div>
        <TxButton
          label={amt0 > 0n ? `Claim ${fmtBTC(amt0)}` : "Claim surplus"}
          variant="ghost"
          state={claim.state}
          disabled={!amt0}
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
            disabled={locked || !amt || blocked.withdraw}
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
            disabled={locked || blocked.close}
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
          Closing needs {fmtMUSD(p.debt - GAS_COMP)} in your wallet. Collateral now {fmtBTC(p.liveColl)}.
        </div>
        {(blocked.withdraw || blocked.close) && (
          <BlockedNote>
            Recovery Mode: {blocked.withdraw && "withdrawing collateral"}
            {blocked.withdraw && blocked.close && " and "}
            {blocked.close && "closing"} {blocked.withdraw && blocked.close ? "are" : "is"} switched off until Mezo leaves it.
          </BlockedNote>
        )}
      </div>

      <BorrowPanel p={p} blocked={blocked.borrow} price={price} onDone={onDone} />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <ListForm p={p} locked={locked} price={price} onDone={onDone} />

        <div className="glass stack">
          <h2>Rescue auction</h2>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Floor (% of equity, {minFloorPct} to 100)</label>
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
              disabled={locked || !auctionInputsOk}
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
            {!auctionInputsOk && (
              <span style={{ color: "var(--bad)" }}>
                {" "}
                Floor must be {minFloorPct} to 100 and the duration 1 to 168 hours.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- list a position for a fixed price ---

export function ListForm({ p, locked, price, onDone }: { p: Position; locked: boolean; price: bigint | null; onDone: () => void }) {
  const { write } = useWallet();
  const [listPrice, setListPrice] = useState("");
  const [minICR, setMinICR] = useState("150");
  const [days, setDays] = useState("3");
  const list = useTx(onDone);
  const parsed = parseAmount(listPrice);
  const fee = useFee("market", parsed);
  const minNum = Number(minICR);
  const icrNow = p.icr === null ? null : Number(p.icr) / 1e16;
  // the contract wants 110% or more and not above what the position has right now
  const minOk = Number.isFinite(minNum) && minNum >= 110 && (icrNow === null || minNum <= icrNow);
  const daysNum = Number(days);
  const daysOk = Number.isFinite(daysNum) && daysNum > 0 && daysNum <= 365;
  void price;
  return (
    <div className="glass stack">
      <h2>Sell at a fixed price</h2>
      <div>
        <label>Price (MUSD)</label>
        <input value={listPrice} onChange={(e) => setListPrice(e.target.value)} inputMode="decimal" placeholder="e.g. 2500" />
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
      <FeeLine price={parsed} quote={fee} role="seller" />
      {!minOk && (
        <div className="muted" style={{ fontSize: 12.5, color: "var(--bad)" }}>
          Promised ICR must be at least 110%{icrNow !== null && ` and no more than the position has now (${icrNow.toFixed(1)}%)`}.
        </div>
      )}
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
          disabled={locked || !parsed || !minOk || !daysOk}
          onClick={() =>
            list.run(() => {
              const expiry = BigInt(Math.floor(Date.now() / 1000) + Math.round(daysNum * 86400));
              const min = BigInt(Math.round(minNum * 100)) * 10n ** 14n;
              return write({ address: ADDR.market, abi: marketAbi, functionName: "list", args: [p.id, parsed!, expiry, min] });
            })
          }
        />
      )}
      <div className="muted" style={{ fontSize: 12.5 }}>
        Listing freezes the vault. Buyers are protected by a snapshot of the position.
      </div>
    </div>
  );
}

// --- borrow more and refinance ---

export function BorrowPanel({ p, blocked, price, onDone }: { p: Position; blocked: boolean; price: bigint | null; onDone: () => void }) {
  const { address, client, write } = useWallet();
  const [amount, setAmount] = useState("");
  const borrow = useTx(onDone);
  const refi = useTx(onDone);
  const amt = parseAmount(amount);
  const rate = useQuery({
    queryKey: ["borrowingRate"],
    queryFn: () =>
      client.readContract({
        address: ADDR.borrowerOperations,
        abi: [{ type: "function", name: "borrowingRate", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const,
        functionName: "borrowingRate",
      }),
  });
  // the fee is added to the debt, so it counts against the new ICR too
  const fee = amt && rate.data !== undefined ? (amt * rate.data) / 10n ** 18n : null;
  const newDebt = amt && fee !== null ? p.debt + amt + fee : null;
  const newIcr = newDebt && price ? (p.liveColl * price) / newDebt : null;
  const unavailable = !VAULT_HAS_BORROW;
  const off = unavailable || blocked;
  return (
    <div className="glass stack">
      <h2>Borrow more and refinance</h2>
      {unavailable && (
        <div className="notice" style={{ marginBottom: 0 }}>
          The vault behind this Deed (the v2 deployment) has no borrow or refinance function, so these two stay off here. They
          switch on with the v3 vault.
        </div>
      )}
      <div>
        <label>Borrow more (MUSD)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" />
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        {fee !== null && newIcr !== null ? (
          <>
            Borrowing fee {fmtMUSD(fee)} is added to your debt. ICR after: <b>{fmtPct(newIcr)}</b>
            {newIcr < MCR && <span style={{ color: "var(--bad)" }}> — under 110%, this would revert</span>}
          </>
        ) : (
          "Enter an amount to preview the fee and the new ICR."
        )}
      </div>
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
        <TxButton
          label="Borrow"
          state={borrow.state}
          disabled={off || !address || !amt || (newIcr !== null && newIcr < MCR)}
          onClick={() =>
            borrow.run(async () => {
              const hints = await getHints(client, p.liveColl, p.principal + amt!);
              return write({ address: p.vault, abi: vaultV3Abi, functionName: "borrow", args: [amt!, hints.upper, hints.lower] });
            })
          }
        />
        <TxButton
          label="Refinance to current rate"
          variant="ghost"
          state={refi.state}
          disabled={off || !address}
          onClick={() =>
            refi.run(async () => {
              const hints = await getHints(client, p.liveColl, p.principal);
              return write({ address: p.vault, abi: vaultV3Abi, functionName: "refinance", args: [hints.upper, hints.lower] });
            })
          }
        />
      </div>
      {blocked && !unavailable && <BlockedNote />}
      <div className="muted" style={{ fontSize: 12.5 }}>
        Refinancing moves the position to today's interest rate; Mezo charges a fee that is added to the debt.
      </div>
    </div>
  );
}
