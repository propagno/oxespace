# Thread mode - release readiness (2026-10-12)

Scope: the Thread backend (`electron/main/services/conversation/*`, orchestrator,
history, IPC) and frontend (`src/components/Threads/*`, stores, hooks) as of the
commits after `07920f7`. Windows 11, Node 24, Electron 44.6, Claude Code 2.1.296.

## Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 35 warnings (all pre-existing `no-console` disable directives) |
| `npm run build` + `verify:bundle` | pass. main 649/904 kB (28.2% headroom), preload 25/40 kB (38.4%), renderer entry 419/500 kB (16.3%), base CSS 421/500 kB (15.8%) |
| Unit + integration (`npm run test:electron`) | 1548 passed; 8 teardown-only failures fixed in this pass (see below); the 5 affected files now pass (71 tests) |
| E2E in Electron | `thread-hardening`, `thread-view`, `thread-session-actions`, `thread-project-navigation`, `thread-project-terminal`, `thread-native-history`, `smoke-hub`: 7/7 |
| `npm run security:audit` (prod deps) | 0 vulnerabilities |
| `npm run security:audit:tools` | exit 0 (8 moderate in the electron-builder chain, pre-existing) |
| `node scripts/check-runtime-support.mjs` | Electron 44.6.0 supported (44.7.0 is the latest stable) |
| `npm run verify:claude-protocol` | OK against Claude 2.1.296 (see below) |

### The 8 teardown failures

`thread-manager`, `thread-project-review`, `thread-projects`, `thread-restore` and
`git-diff-summary` failed only in `rmSync` of their temp directory
(`EPERM`, a just-exited git process still holding the folder on Windows); their
assertions had already passed. `tests/helpers/removeTempDir.ts` now retries briefly
and ignores EPERM/EBUSY/ENOTEMPTY on Windows only; anywhere else the error is
thrown. These tests were not touching product code.

## Protocol assumptions, checked against the installed CLI

Thread mode talks to Claude over `--input-format stream-json`. The field names and
behaviours it depends on were verified two ways against Claude Code 2.1.296: by
reading the request/response schema strings in the shipped binary, and with a
no-inference live probe (`scripts/probe-claude-protocol.cjs`).

| Behaviour | Evidence |
|---|---|
| `system/api_retry` with `attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error` | in binary |
| `can_use_tool` carries `permission_suggestions`, `blocked_path`, `decision_reason`, `decision_reason_type`, `classifier_approvable`, `suppress_always_allow_rule`, `default_to_no`, `matched_ask_rule` | in binary |
| allow response accepts `updatedInput`, `updatedPermissions`, `toolUseID` | in binary |
| `interrupt` with `cancel_queued`, answered `success` with `still_queued` / `cancelled` | live probe: OK |
| `stop_task` with `task_id` | in binary (not used yet) |
| `result` carries `total_cost_usd` and `usage` | in binary |

`decision_reason` may contain ANSI escapes; they are removed whole before display.
A prompt the CLI marks `suppress_always_allow_rule`, `classifier_approvable: false`
or `safetyCheck` never offers "allow for the session".

## Not verified (needs a real session or another platform)

- A real permission prompt end to end (needs a tool call, so inference quota).
  Covered by fake-transport tests and the schema check only.
- A real provider retry (`api_retry`) and a real cooperative interrupt of a
  *running* turn (the probe proves the request is accepted, not a mid-turn stop).
  The 2 s fallback to ending the process bounds the worst case.
- Whether `total_cost_usd` is per turn or cumulative for the process on every CLI
  version; if cumulative, the running total is inflated. The chip says "estimate".
- Codex 0.129+ hook trust (`config.toml` hash) for status hooks; without it Codex
  hooks may not fire and the heuristic remains in charge.
- Linux and macOS: only Windows was exercised here; CI covers Linux.

## Known limits shipped as-is

- Steering a running Claude turn is not available (queue only).
- Background tasks and subagents are observable, not stoppable from the UI
  (the CLI supports `stop_task`; wiring is open).
- The shell-rule engine, Windows path check and lead-status fold are implemented
  and tested but not consumed by the UI yet; they change no behaviour today.
- Cost is shown for Claude only; Codex reports tokens, not dollars.

## Draft release notes

**Thread**
- Notifications when a conversation finishes, fails or needs approval, with unread
  markers; works while Code mode is showing, never for a thread you are watching.
- Sidebar search also finds conversations by their content.
- Claude approvals explain why they are asked (reason, blocked path, matched rule)
  and can be allowed for the session when the CLI proposes a rule; plans are shown
  as text.
- Stopping a Claude turn now interrupts it cooperatively and keeps the session and
  its background tasks alive.
- Provider retries (rate limit, overload) show as one updating line, not an error.
- Running cost estimate per conversation; quota alerts at 50/75/90/95%.
- Message delivery state, context ring, queue pause, incremental reads and
  verified rewind (earlier in this cycle).
- Ctrl+Alt+PageUp/PageDown and Ctrl+Alt+N for conversation navigation.

**Operations**
- Worktree hooks (`oxe.yaml`), safe worktree removal and cleanup, agent status
  through hooks, session search and scheduled automations.
