# Serves the built frontend from WSL and runs the browser click-through against it, all in one go.
# Usage (Windows PowerShell): scripts\run-ui-pass.ps1 [-ShotDir ui-shots]   (set $env:REST='1' to resume from existing chain state)
# Needs: a production build in frontend/ made with the deployed addresses (cd frontend; npx next build), Chrome,
# and .env in the repo root with BUYER_KEY and SELLER_KEY. The repo is expected to live in a WSL distro.
param([string]$ShotDir = "$PSScriptRoot\..\ui-shots", [string]$Distro = "Ubuntu")

$root = [IO.Path]::GetFullPath("$PSScriptRoot\..")
$null = New-Item -ItemType Directory -Force $ShotDir
$env:SHOT_DIR = [IO.Path]::GetFullPath($ShotDir)

# \\wsl.localhost\Ubuntu\home\me\Deed -> /home/me/Deed
$prefix = '\\wsl.localhost\' + $Distro
if (-not $root.StartsWith($prefix)) { throw "run this from a repo that lives in the $Distro WSL distro, got $root" }
$linuxRoot = $root.Substring($prefix.Length).Replace('\', '/')

$server = Start-Process wsl -ArgumentList "-d", $Distro, "--", "bash", "$linuxRoot/scripts/serve-frontend.sh" -PassThru -WindowStyle Hidden
try {
  $up = $false
  for ($i = 0; $i -lt 40 -and -not $up; $i++) {
    Start-Sleep 2
    try { $up = (Invoke-WebRequest -Uri http://localhost:3111/ -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch {}
  }
  if (-not $up) { throw "frontend did not come up on :3111" }
  node --env-file="$root\.env" "$root\scripts\ui-pass.mjs"
  exit $LASTEXITCODE
} finally {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  wsl -d $Distro -- bash "$linuxRoot/scripts/stop-frontend.sh"
}
