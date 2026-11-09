# Setup Go7 Flicks on the Windows D: drive in the proper git folder.
# Pattern matches D:\GitHub\OperationOops-FunSession on DadOffice.
#
# Run in PowerShell:
#   irm https://raw.githubusercontent.com/SteveMLC/go7-flicks/cursor/dual-video-and-locked-ui/scripts/setup-windows-d.ps1 | iex
# or from a checkout:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows-d.ps1

$ErrorActionPreference = "Stop"

$Root = "D:\GitHub"
$Repo = Join-Path $Root "go7-flicks"
$Branch = "cursor/dual-video-and-locked-ui"
$Remote = "https://github.com/SteveMLC/go7-flicks.git"

if (-not (Test-Path "D:\")) {
  throw "D: drive not found. Run this on the Windows PC that has D: (DadOffice)."
}

New-Item -ItemType Directory -Force -Path $Root | Out-Null

if (-not (Test-Path (Join-Path $Repo ".git"))) {
  Write-Host "Cloning $Remote -> $Repo"
  git clone $Remote $Repo
} else {
  Write-Host "Repo already at $Repo; fetching $Branch"
}

Set-Location $Repo
git fetch origin
git checkout $Branch
git pull --ff-only origin $Branch

$head = (git rev-parse HEAD).Trim()
$branchNow = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "HEAD $head on $branchNow"

$icon = Join-Path $Repo "build\icon.ico"
if (-not (Test-Path $icon)) {
  throw "Missing $icon"
}
Write-Host "Icon OK: $icon"

Write-Host "npm install..."
npm install

Write-Host ""
Write-Host "Ready at $Repo"
Write-Host "Next (optional installer): npm run dist:win"
Write-Host "Installer: $Repo\release\Go7Flicks-Setup-0.1.0.exe"
