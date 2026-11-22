---
question: "Can node-pty run in an Electron 44 utilityProcess on Windows and Linux, where must terminal state live, what does it buy under PERF-A0, and is a DB worker needed?"
answer: "Partial. Linux x64: it runs, with no repeatable main-loop or key-echo gain and about 106-148 MB more peak working set; terminal state stays in main; no-go for the DB worker on this evidence; T7 and T8 need a CR. Windows: not measured."
evidence: "remote-verify runs 45000920984 (standalone probe) and 45001553450 (built app under perf-load, SQLite timing, packaged Linux probe); baseline run 44675710488."
---

# T6 spike (OXE-121): node-pty in an Electron utilityProcess

**Status: answered for Linux x64. Windows was not measured, so that part of the question is still open.**

## Question

With node-pty in an Electron 44 utilityProcess (behind OXESPACE_PTY_HOST=1), packaged on Windows (ConPTY, asarUnpack) and Linux:

1. Does a pane start, take keys, resize and exit cleanly on before-quit?
2. What are the postMessage latency and throughput at 8 x ~1 MB/s?
3. Where must the ring buffer, attach/readSince/peek, the agent-state feed and the MCP terminal reads live once output bypasses the main process?
4. Does PERF-A0 reach main:loop p95 <= 16 ms and key echo <= 25 ms (baseline run 44675710488)?
5. Which SQLite operations block the main process over 16 ms under PERF-A0 (go/no-go for stage 2, OXESPACE_DB_WORKER)?

## Answer

**It works on Linux, but showed no repeatable speed gain under PERF-A0.** Build T7 only if process isolation is worth about 106-148 MB more peak working set, with the key off by default.

| # | Linux | Windows |
|---|---|---|
| 1 | Yes in a standalone probe. Packaged: start, input, resize and quit work | **Not measured** |
| 2 | Round trip p50 0.15-0.16 ms, p95 0.26-0.36 ms. Sustains the paced 8.05 MiB/s (maximum not measured) | **Not measured** |
| 3 | In main (from reading the code) | Same code |
| 4 | **No**: loop p95 21.3-21.5 ms, key echo 53.6-76.4 ms with the host | **Not measured** |
| 5 | None seen: slowest timed call 8.24 ms, on a fresh database | **Not measured** |

### T7 design

- **Ownership.** The host owns only node-pty. The ring, modes, DA1 filter, batcher, attach/readSince/peek, agent-state feed and MCP reads stay in main. `peek` and `readSince` have synchronous callers (agent-state history, MCP tools, remote gateway), and `attach` relies on flush, snapshot and mark-attached happening in one tick.
- **No second batcher in the host.** It cut main CPU in the probe but added about 9 ms to the median echo, and main already batches for 16 ms.
- **CR needed before T7: add `electron/main/services/terminal/session-start.ts` to its files.** It expects a synchronous spawn that returns a pid or throws. Over a process boundary both arrive later, so the start must be awaited to keep the launch error, the incident and the runtime record.
- **pid before kill.** With pid 0, `terminatePty` only releases the PTY and skips the process tree. A stop during a pending start must wait for the pid.
- **Quit order.** `stopAll` starts tree kills without awaiting them and runs twice on quit. Kill the host only after those kills settle (or at their deadline), and never fork a new host from the second call. Killing the host first hangs up the shells before the tree snapshot, so detached children would be missed.
- **Windows.** Forward `useConptyDll: true`. node-pty's conout worker inside a packaged utilityProcess is untested and must pass on Windows before the key is turned on there.

### T8 needs a CR

Output cannot simply bypass main. Main must still receive every byte for the items above, and it edits the stream (DA1 removal, ConPTY start screen) and numbers it for attach. A direct host-to-window port therefore needs either those steps and the sequence numbers moved to the host, or an attach protocol that reconciles two streams. T8's file list has neither `session-output.ts` nor `terminal.service.ts`. This is from code reading; the MessagePort path was not prototyped.

### Targets

`main:loop p95 <= 16 ms` cannot be met as perf-load measures it: the spec reports the raw 20 ms histogram, which read 21.15 ms in an idle Node process. The performance journal subtracts those 20 ms. The target or the spec has to change before it can be a gate.

### Stage 2 (DB worker): no-go on this evidence

No timed SQLite call reached 16 ms. This does not cover a large user database, Windows, or agent and conversation write load, so reopen it if one of those shows a slow call.

## Evidence

Both spike runs are remote-verify on ubuntu-22.04 with Xvfb, from HEAD ac076e223.

| Run | What | Snapshot |
|---|---|---|
| [45000920984](https://github.com/propagno/oxespace/actions/runs/45000920984) | Standalone Electron 44.10.0 probe | 2fc80ec91 |
| [45001553450](https://github.com/propagno/oxespace/actions/runs/45001553450) | Built app under perf-load, SQLite timing, packaged probe | 4af6a3611 |
| [44675710488](https://github.com/propagno/oxespace/actions/runs/44675710488) | Existing baseline on main | c08a1b22e |

### Standalone probe (run 45000920984)

8 writers for 20 s, 161.6 MiB per run, 3 runs per mode, 190 echo samples per run. `raw` posts each chunk; `batch` posts every 16 ms or 32 KiB.

| Measure | In main | Host raw | Host batch |
|---|---|---|---|
| Main-process CPU, median | 2277 ms | 1474 ms | 655 ms |
| Chunks or messages | 38237-40771 | 29693-29836 | 6638-6710 |
| Round trip p50 | n/a | 0.15-0.16 ms | 0.16 ms |
| Round trip p95 | n/a | 0.26-0.36 ms | 0.29-0.34 ms |
| Echo p50 | 0.18 ms | 0.34-0.35 ms | 8.93-9.64 ms |
| Echo p95 | 0.33-0.41 ms | 0.61-0.80 ms | 15.87-16.63 ms |
| Loop p95, raw histogram | 21.12-21.15 ms | 21.20 ms | 21.18-21.20 ms |

- The main-process consumer only counted bytes, and the host's own CPU was not measured: this is not a total CPU saving.
- All 10 runs resized to 100x30 and reported exit code 7.
- In the 9 quit runs the remaining `sleep` child was gone after the 1.5 s wait.
- In the one host SIGKILL run that child was gone too. Exit-notification time, re-forking and children that ignore SIGHUP were not tested.

### Built app under PERF-A0 (run 45001553450)

One runner, in this order, 3 rounds each. All five passed perf-load with 161.6 MiB per round.

| Median | Baseline | 1 off | 2 raw | 3 batch | 4 off | 5 raw |
|---|---|---|---|---|---|---|
| main:loop p95, ms | 21.3 | 21.3 | 21.3 | 21.5 | 21.2 | 21.3 |
| main:loop max, ms | 31.4 | 39.0 | 39.2 | 36.4 | 29.2 | 28.9 |
| key echo, ms | 40.0 | 62.1 | 76.4 | 71.5 | 61.2 | 53.6 |
| Ctrl K, ms | 145.4 | 149.4 | 159.4 | 197.1 | 135.0 | 146.5 |
| workspace switch, ms | 45.0 | 45.3 | 51.7 | 49.2 | 45.3 | 50.6 |
| working set at peak, MB | 1086.8 | 1104.2 | 1230.3 | 1209.8 | 1101.2 | 1248.8 |
| working set 10 s after, MB | 720.6 | 719.7 | 823.9 | 877.7 | 765.6 | 870.4 |

- The two raw runs fall on both sides of the off runs for key echo, so no gain or loss can be claimed there.
- With the key off, echo was 61-62 ms against the baseline's 40 ms. Commit, runner and instrumentation all differ, so the cause is unknown. Compare only within this run.
- Windows baseline, for reference: loop p95 22.1 ms, key echo 39.1 ms.

### SQLite (run 45001553450)

- Timed: prepare, run, get, all, exec and transaction. Not timed: pragma, iterate and opening the database.
- Each of the five runs logged 21-25 calls of 2 ms or more. Nearly all were first-boot migrations (max 7.11 ms).
- The others happened during pane setup or at about the time round 1 started: a prepare (8.24 ms, the slowest) and reads of pane_agent_sessions, internal_mcp_meta and mcp_servers. None was logged later in the load.

### Packaged Linux (run 45001553450)

electron-builder `--linux --dir` with the repository's config and the main entry replaced by a probe. The host was forked from inside app.asar: isPackaged true, resize seen, host acknowledged quit, shell gone afterwards. The whole app was not run packaged with the host, and a shell exit code was not checked there.

## Not measured, and limits

- **Windows, all of it** (ConPTY, packaging, latency, PERF-A0). remote-verify has only a Linux runner. The optional ci/perf-load-spike-121 push was not made: it needs the prototype in a commit, the write tool refused scratch files in .oxe/tmp/T6, and perf-load does not package the app anyway.
- The in-app prototype was a minimal adapter with an asynchronous pid, no crash recovery and no explicit host shutdown. It measures cost and is not a T7 implementation.
- The prototype was created only on the CI runners by the remote-verify commands, which are printed in both run logs.
- The task note names .oxe/spikes/T5.md. This report follows T6's declared scope, .oxe/spikes/T6.md.
