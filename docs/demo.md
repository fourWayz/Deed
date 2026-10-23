# Demo script

Two wallets on Mezo testnet, each with some test BTC. Wallet B also needs MUSD to buy with (open its own position
first and keep the borrowed MUSD). Frontend running with the deployed addresses in `.env.local`.

## 1. Open a position (wallet A)

- My Positions, enter `0.1` BTC and `2000` MUSD. The form shows the ICR before you sign.
- Confirm. A new Deed appears under "Your Deeds". The vault holds the trove, the 2,000 MUSD is in wallet A.

Say: the trove belongs to a vault, and the Deed is the key to it.

## 2. List it (wallet A)

- Open the Deed, "Sell at a fixed price": price `1500` MUSD, min ICR `150`, 3 days. List.
- Point out the notice that the vault is frozen. Try "Withdraw collateral": it is disabled, and the contract
  would revert too.

## 3. Buy it (wallet B)

- Market tab. The listing shows collateral, debt, ICR, rate, equity vs price and the countdown.
- Click Buy. The app approves MUSD if needed, then sends `buy` with the snapshot hash it computed from the position.
- The Deed moves to wallet B. In My Positions wallet B now manages the vault; wallet A can't.
- Wallet A: "Sale proceeds waiting" appears, claim it. Payment is pulled, not pushed.

Optional proof of buyer protection: as wallet A, cancel a second listing, add 1 wei of collateral, relist at the same
price, then buy from B with the old page still open. The transaction reverts with `SnapshotMismatch`.

## 4. Rescue auction

On testnet the BTC price can't be crashed on demand, so use one of these:

- **Owner-started** (works any time): wallet B opens the Deed, "Rescue auction", floor 50%, 1 hour, Start.
- **Public rescue** (needs a position under the rescue line, 130% in the default deploy): open a position near the
  minimum collateral, for example `0.0225` BTC against `1800` MUSD at about 80k, and wait for the price to move,
  or use the local fork test `RescueAuction.t.sol` which drives the price.

Then:

- Rescue tab. The auction shows a live price counting down, the floor, time left and the ICR the winner must reach.
- Wallet A clicks "Bid at current price". The app computes the BTC top-up with `requiredTopUp`, approves MUSD,
  and sends the bid with the BTC.
- The Deed moves to wallet A, the position leaves above the safe ICR, wallet B claims the MUSD.
- If nobody bids, after the duration anyone can "End auction" and the Deed goes back to the seller.
