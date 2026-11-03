# Tolle installer for Windows servers (including Server Core – no desktop needed).
#
#   irm https://github.com/shotgn16/Tolle/releases/latest/download/install.ps1 | iex
#
# Run in PowerShell as Administrator. Downloads the Tolle server and starts the setup assistant.
# For a normal Windows PC, the desktop installer (Tolle-Setup-…-windows-x64.exe) is easier.
$ErrorActionPreference = 'Stop'
$Repo = 'shotgn16/Tolle'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Warning 'Run PowerShell as Administrator to install Tolle as a background service.' }

$version = $env:TOLLE_VERSION
if (-not $version) {
  $version = (Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest").tag_name.TrimStart('v')
}
$url = "https://github.com/$Repo/releases/download/v$version/tolle-server-$version-windows-x64.zip"
$dir = Join-Path $env:TEMP "tolle-$version"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Write-Host "Downloading Tolle $version…"
$zip = Join-Path $dir 'tolle-server.zip'
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $dir -Force
Remove-Item $zip

Write-Host ''
Write-Host 'Starting the Tolle setup assistant.'
Write-Host "Choose 'A server for several people' to run Tolle in the background from start-up."
& (Join-Path $dir 'tolle-server\tolle-server.exe') setup
