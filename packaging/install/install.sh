#!/bin/sh
# Tolle installer for Linux and macOS servers (no desktop needed).
#
#   curl -fsSL https://github.com/shotgn16/Tolle/releases/latest/download/install.sh | sh
#
# Downloads the Tolle server for this computer, then starts the setup assistant in the terminal.
# Options (environment variables):
#   TOLLE_VERSION=0.2.0     install a specific version instead of the latest
#   TOLLE_DIR=/some/folder  where to keep the program (default: ~/.local/share/tolle-server on Linux,
#                           ~/Library/Application Support/Tolle/server-program on macOS).
#                           A server for several people is copied to /opt/tolle (Linux) or
#                           /Library/Application Support/Tolle/server (macOS) during setup.
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

if [ "$os" = macos ]; then default_dir="$HOME/Library/Application Support/Tolle/server-program"
else default_dir="${XDG_DATA_HOME:-$HOME/.local/share}/tolle-server"; fi
dir=${TOLLE_DIR:-$default_dir}
mkdir -p "$dir"
rm -rf "$dir/tolle-server"
say "Downloading Tolle for $os ($arch)…"
curl -fL --progress-bar "$url" -o "$dir/tolle-server.tar.gz" || fail "Download failed: $url"
tar -C "$dir" -xzf "$dir/tolle-server.tar.gz"
rm -f "$dir/tolle-server.tar.gz"
if [ "$os" = macos ]; then xattr -dr com.apple.quarantine "$dir/tolle-server" 2>/dev/null || true; fi

bin="$dir/tolle-server/tolle-server"

# Put a "tolle-server" command on the PATH when ~/.local/bin is used (most Linux desktops and servers).
if [ "$os" = linux ] && [ "$(id -u)" -ne 0 ]; then
  mkdir -p "$HOME/.local/bin" && ln -sf "$bin" "$HOME/.local/bin/tolle-server"
fi

say ""
say "Tolle is downloaded to: $dir/tolle-server"
say "Starting the Tolle setup assistant…"
say ""
# Read answers from the keyboard even when this script itself is piped into sh.
# Setup runs as you; if you choose a server for several people it asks for administrator rights itself.
"$bin" setup < /dev/tty
