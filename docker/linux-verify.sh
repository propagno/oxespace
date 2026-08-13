#!/usr/bin/env bash
# Linux verification chain. Runs inside docker/linux-verify.Dockerfile.
#
# Each stage prints a banner and aborts the run on failure, so the first red
# banner is the finding — no scrolling back through npm output to locate it.
set -euo pipefail

stage() { printf '\n\033[1;36m=== %s ===\033[0m\n' "$1"; }

stage "Host"
echo "$(uname -srm) · node $(node -v) · npm $(npm -v)"

stage "Native modules (informational)"
# Informational ONLY. native:doctor probes under plain Node, and better-sqlite3
# is deliberately built for the Electron ABI — so it reports a mismatch on a
# correctly set up checkout, on Linux exactly as on Windows. Gating on it would
# fail every healthy run. The real proof that the modules compiled is the
# test:electron stage below, which loads them under the matching ABI.
npm run native:doctor || true

stage "Typecheck"
npm run typecheck

stage "Lint"
npm run lint

stage "Unit + integration"
# Runs under the Electron ABI. This is where the POSIX-only paths finally
# execute: migration 046 (bash seeding + repointing), the safe-join POSIX
# suite that is skipped on Windows, script-command, and the shell-profile
# defaults.
#
# --no-file-parallelism is about determinism, not correctness. A container gets
# a fraction of the host's CPU, and under full parallel load the userEvent-heavy
# renderer tests (SettingsSidebar in particular) blow their 5s default timeout
# while passing in 0.7s on their own. A harness that flakes is a harness people
# learn to ignore, so trade wall-clock for a trustworthy signal.
npm run test:electron -- --no-file-parallelism

stage "Build"
npm run build

stage "E2E smoke (Xvfb)"
# Launches real Electron windows against a private virtual display. The wrapper
# owns the X server lifecycle; xvfb-run can remain orphaned after Playwright
# repeatedly launches and force-closes Electron during the long perf suite.
bash scripts/run-with-xvfb.sh npm run test:e2e

stage "E2E performance gate (Xvfb)"
OXESPACE_PERF_GATE=1 bash scripts/run-with-xvfb.sh npm run bench:ui

stage "Done"
echo "Linux verification passed."
