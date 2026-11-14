# UI polish pass

Presentation only. No contract config, abis, useSafeWrite, data hooks, transaction flows,
error mapping or Recovery Mode logic was changed.

## What changed
- Type and tokens: Bricolage Grotesque (headings) and Inter (text) through next/font, tabular
  numerals on every money, ratio and percentage figure, one type scale, CSS variables for
  colour, radius, blur, shadow, spacing and motion. Text colours are at least 4.5:1.
- Landing: hero with the two venues, drifting CSS gradient backdrop, live stats strip with
  count-up and the test-wallet label, staggered how it works, fee card, video poster slot.
- Shell: sticky glass nav with active route, network pill (31611), wallet button, bottom nav at
  390px, footer with contract links, skip link.
- Position: animated ICR gauge with a words line, stacked debt bar, fee receipt, disabled
  buttons say why.
- Market and Rescue: hover and press states, sort and filter chips, auction countdown and
  price ticker, card-shaped skeletons.
- One shared transaction status (three steps, explorer link, Retry, Dismiss, aria-live).
- Empty, error and loading states with small SVGs, copy buttons on addresses and hashes.
- Meta: favicon, per-route titles, Open Graph and Twitter tags, static og.png.

## Landing bundle
Before 4.79 kB (220 kB first load), after 5.4 kB (220 kB first load).

## Checks (interface only, no transaction was sent)
- `scripts/ui-polish-check.mjs`: 39 of 39 passed, results in `ui-polish-check.json`. It uses
  rewritten RPC reads to simulate positions, listings, auctions and pending debt.
  Covers overflow at 390, 768 and 1440px, 44px targets, tab order on 9 routes, reduced
  motion, CLS, the failed-write status.
- `scripts/ui-pass-v3-live.mjs` with `PHASES=0,1,7,8,9` as a regression: 37 of 37 passed,
  results in `ui-pass-v3-polish-regression.json`. One selector broke during the work: the
  empty state for Positions repeated "No positions yet" and matched twice. Fixed in the app copy.

## Not tested
- A live success path through the new status component, the live rescue start, bid and close
  and the auction card on a real auction (no active position survives the redemption bot).
- Real wallets and phones. The Open Graph url depends on the site env at build time.
