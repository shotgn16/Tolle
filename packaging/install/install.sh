#!/bin/sh
# Tolle installer for Linux and macOS servers (no desktop needed).
#
#   curl -fsSL https://github.com/shotgn16/Tolle/releases/latest/download/install.sh | sh
#
# Downloads the Tolle server for this computer, then starts the setup assistant in the terminal.
# Options (environment variables):
#   TOLLE_VERSION=0.2.0     install a specific version instead of the latest
#   TOLLE_DIR=/opt/tolle    where to put the program before setup moves it (default: a temporary folder)
set -eu

REPO="shotgn16/Tolle"
say() { printf '%s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

os=$(uname -s); arch=$(uname -m)
case "$os" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  *) fail "This script is for Linux and macOS. On Windows use install.ps1." ;;
esac
case "$arch" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) fail "Unsupported processor: $arch (Tolle supports x64 and arm64)." ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl is needed. Install it and run this again."
if [ -n "${TOLLE_VERSION:-}" ]; then
  url="https://github.com/$REPO/releases/download/v$TOLLE_VERSION/tolle-server-$TOLLE_VERSION-$os-$arch.tar.gz"
else
  v=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)
  [ -n "$v" ] || fail "Couldn't find the latest Tolle release. Check your internet connection."
  url="https://github.com/$REPO/releases/download/v$v/tolle-server-$v-$os-$arch.tar.gz"
fi

dir=${TOLLE_DIR:-$(mktemp -d)}
mkdir -p "$dir"
say "Downloading Tolle for $os ($arch)…"
curl -fL --progress-bar "$url" -o "$dir/tolle-server.tar.gz" || fail "Download failed: $url"
tar -C "$dir" -xzf "$dir/tolle-server.tar.gz"
rm -f "$dir/tolle-server.tar.gz"
if [ "$os" = macos ]; then xattr -dr com.apple.quarantine "$dir/tolle-server" 2>/dev/null || true; fi

bin="$dir/tolle-server/tolle-server"
say ""
say "Starting the Tolle setup assistant."
say "Choose 'A server for several people' to run Tolle in the background from start-up."
say ""
# Read answers from the keyboard even when this script itself is piped into sh.
if [ "$(id -u)" -eq 0 ]; then
  "$bin" setup < /dev/tty
elif command -v sudo >/dev/null 2>&1; then
  say "(You may be asked for your password – installing a background service needs administrator rights.)"
  sudo "$bin" setup < /dev/tty
else
  "$bin" setup < /dev/tty
fi
