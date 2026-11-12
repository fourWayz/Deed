#!/bin/bash
# Builds the frontend the way Vercel will: from a clean copy of frontend/ (no node_modules, no .next, no .env.local),
# `npm ci`, environment taken only from frontend/.env.example. Proves the build does not lean on anything outside frontend/
# or on a local env file. Nothing is deployed and no Vercel account is touched.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/frontend"
(cd "$here/frontend" && tar --exclude=node_modules --exclude=.next --exclude=.env.local --exclude=tsconfig.tsbuildinfo --exclude=next-env.d.ts -cf - .) | tar -xf - -C "$work/frontend"
cd "$work/frontend"
npm ci --no-audit --no-fund >/dev/null
set -a; . ./.env.example; set +a
# the example leaves the WalletConnect id empty (it is the owner's own), the build does not need it, running the app does
npx next build
echo "clean build ok in $work (removed on exit)"
