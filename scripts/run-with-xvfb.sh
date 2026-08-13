#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: scripts/run-with-xvfb.sh <command> [args...]" >&2
  exit 2
fi

command -v Xvfb >/dev/null || {
  echo "Xvfb is required for Linux Electron tests." >&2
  exit 1
}

# Pick a free local display. TCP is disabled, so -ac only removes the brittle
# xauth cookie exchange inside this isolated runner/container.
display_number="${OXESPACE_XVFB_DISPLAY:-99}"
while [[ -e "/tmp/.X11-unix/X${display_number}" ]]; do
  display_number=$((display_number + 1))
done

Xvfb ":${display_number}" -screen 0 1280x1024x24 -nolisten tcp -ac &
xvfb_pid=$!

cleanup() {
  kill "${xvfb_pid}" 2>/dev/null || true
  wait "${xvfb_pid}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in {1..100}; do
  [[ -S "/tmp/.X11-unix/X${display_number}" ]] && break
  kill -0 "${xvfb_pid}" 2>/dev/null || {
    echo "Xvfb exited before display :${display_number} became ready." >&2
    exit 1
  }
  sleep 0.05
done

if [[ ! -S "/tmp/.X11-unix/X${display_number}" ]]; then
  echo "Timed out waiting for Xvfb display :${display_number}." >&2
  exit 1
fi

export DISPLAY=":${display_number}"
unset XAUTHORITY
"$@"
