#!/bin/sh
# Home Assistant add-on entry point. /data is the add-on's persistent, backed-up folder.
set -e
cd /app
echo "[Tolle] Starting – open it from the Home Assistant sidebar."
exec python3 -m server
