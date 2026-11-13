# Vercel preview

Nothing here has been deployed. There is no Vercel CLI or linked project on the machine this was prepared on, and a deploy
publishes the app, so it is left as a deliberate step. Production (`frontend-iota-blush-70.vercel.app`) is not touched by
anything below: every command uses the preview environment and never `--prod`.

## Check the build first

```bash
scripts/preview-build-check.sh
```

Copies `frontend/` to a temp directory without `node_modules`, `.next` or `.env.local`, runs `npm ci`, loads only
`frontend/.env.example`, and runs `next build`. This is what Vercel will do, so it catches a build that depends on a local
file or on anything outside `frontend/`. Result of the last run is in `docs/ui-pass-v3.md`.

## Project settings (Vercel dashboard, once)

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` (the repo root is a Foundry project) |
| Framework Preset | Next.js |
| Node.js version | 22.x |
| Build / Install command | defaults (`next build`, `npm install`) |
| Production branch | leave as it is, a preview comes from any other branch, for example `feat/frontend-v2` |

## Environment variables, Preview scope only

Add these with the scope set to **Preview**, not Production. They are all `NEXT_PUBLIC_*`, so they end up in the browser
bundle: none of them is a secret, and none may become one. The values below are the v3 deployment in `deployments.json`.

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_DEED_NFT` | `0x9C92E662cB7de018162E1d06F1f977f6A0B5547f` |
| `NEXT_PUBLIC_FACTORY` | `0xb8602DBF0e5BBDE81C504C87F860fbbe7DF125CD` |
| `NEXT_PUBLIC_MARKET` | `0x862e105bDE51B27c3B9670810c5B9Ea3b470Cbdd` |
| `NEXT_PUBLIC_AUCTION` | `0xbF4Fe3aF0C5c138AE28230AF1Cb9b0C8cf2c8355` |
| `NEXT_PUBLIC_LENS` | `0xDd628bBb4663549E0Af7815E93D14002D1f9Dde1` |
| `NEXT_PUBLIC_START_BLOCK` | `16737425` |
| `NEXT_PUBLIC_DEPLOYMENT_VERSION` | `v3` |
| `NEXT_PUBLIC_WC_PROJECT_ID` | your own id from cloud.walletconnect.com (the app does not start without one) |
| `NEXT_PUBLIC_INDEXER_URL` | `https://deed-lovat.vercel.app` (the indexer follows v2 and v3, CORS is open) |
| `NEXT_PUBLIC_TEAM_WALLETS` | `0x522bc0c3919ff823173ca4145feece905f772ffe,0xef05acadf5d3ff7e8e5f0be2515f2be351e225a6,0x4989CC7150a869D6b07540B54B96fD02c5e0537c` (public addresses, drives the "team's test wallets" label) |
| `NEXT_PUBLIC_DEMO_VIDEO` | optional, mp4 or Vimeo player url |

Without `NEXT_PUBLIC_INDEXER_URL` the activity numbers are counted from chain events in the browser, which works but is slow and
only covers v3. WalletConnect needs the preview's domain added to the allowed domains of that project id, or it will refuse
the connection from the preview url.

## Deploy a preview (when you decide to)

```bash
cd frontend
npx vercel link                              # picks or creates the project, writes frontend/.vercel (ignored by git)
npx vercel pull --environment=preview        # downloads the Preview env vars
npx vercel build                             # a preview build, prebuilt output in .vercel/output
npx vercel deploy --prebuilt                 # no --prod: this creates a preview url and leaves production alone
```

Or push the branch and let Vercel's git integration build a preview from it. Check that the url printed by `vercel deploy` is
not the production alias before sharing it.
