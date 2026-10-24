#!/bin/bash
# Serves the production build of the frontend on :3111 (run `npx next build` in frontend/ first).
export PATH=$(ls -d ~/.nvm/versions/node/v22*/bin 2>/dev/null | tail -1):$PATH
cd "$(dirname "$0")/../frontend"
exec npx next start -p 3111 -H 0.0.0.0
