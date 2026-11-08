# CCR: F11 backend — the usage count, the outgoing hosts proxy, what ships, the build diary (1.5.0)

Owner: BACKEND. Status: frozen tests for review (M5: HML, DESIGN, FE; SECURITY: TECH LEAD for the proxy).

**Criteria:**
- **With backend work:** A65 (N7), A68 (H4), A39 and A41 (what ships, as guards) and A66 (N8).
- **The window's or the release's, on what's on main:**
  - A40, the downgrade screen (T87);
  - What's new, from the renderer catalog;
  - the updater's copy, and its wait during a critical approval, which is the window's own (FRONTEND);
  - A3: baselines and verify (SRE/HML).

**Contract:** DESIGN's `1.5.0-f11-design.md` "Data each screen needs", with FRONTEND's names (08/11).

**Frozen tests:** `tests/acceptance/f11/`: 18 tests in 4 files.

| File | Tests | Runs on |
|---|---|---|
| `a65-usage-count.native.test.ts` | 5 | Electron's Node, a migrated DB, an injected clock, fetch watched |
| `a68-hosts-proxy.native.test.ts` | 6 | Electron's Node, real loopback sockets |
| `a39-release.test.ts` | 4 | Node, the builder config and the diary pages as data |
| `f11-contract.test.ts` | 3 | Node |

**Tasks:** `.claude/roadmap-1.4/team/plans/f11-tasks-BACKEND.json`: 5 tasks with the pack fields (F11-USAGE, F11-PROXY, F11-IPC, F11-SHIP, F11-DIARY).

**Migrations** (main's highest + 1 at execute): 101 `feature_usage`, 102 `outgoing_hosts`.

## A65 · The usage count on this computer

**Off by default.** That holds on a fresh install and on an upgrade: an upgraded database has no setting row, which reads off. It never prompts to turn itself on.

**`FEATURE_USAGE_KEYS`** (`shared/feature-usage.ts`) is a closed catalog of camelCase keys, which the window translates. Anything else, such as content or a mistyped key, is ignored.

**`UsageCount`:**
- `status()` → `{ enabled, since, rows: [{ feature, uses, lastUsed }] }`, covering the last 30 days with the largest count first. While off it has no rows.
- `setEnabled(on, { clear? })`: turning off keeps the counts unless `clear` is set.
- `record(feature)`: counts only while on.
- `export(path)`: writes the same rows as JSON.
- `clear()`.

**Nothing is sent:** there are no network calls, and the test watches `fetch`.

## A68 · The outgoing hosts proxy (SECURITY)

**Off by default.** When on, it listens on 127.0.0.1 only.

**What reaches agents:** agents started from then on get `HTTP(S)_PROXY` with a per-origin credential, so each connection is attributed to its conversation. A pane, or a connection without credentials, is "Outside a conversation". Agents that are already running are unchanged.

**CONNECT:** it logs host and port, then answers 200 and splices both sockets without reading or changing a byte. There's no certificate and no TLS interception.

**Plain HTTP:** it's forwarded, and logged by host and port.

**It never blocks.** An unreachable target answers 502 and is still logged.

**Never stored, anywhere:** a path, a query, a header or a body. The test dumps every table to check.

**Failure is a state.** A port that's taken, or any other failure, gives `state: failed` with `reason` (C3 `hostsProxy.portInUse { port }` or `hostsProxy.failed`). Agents then get no proxy environment, and `retry()` starts it again.

**The data:** `status()` → `{ enabled, state, reason?, hosts: [{ host, port, count, lastSeen, firstSeen, conversationId?, conversationTitle? }] }`, newest first. Also `setEnabled`, `clear`, `retry` and `envFor`.

## A39–A41 · What ships (guards)

These pass on main and must keep passing through the version bump and the release PR:
- `electron-builder.yml`: `productName: OXESpace`; every `artifactName` is `OXESpace-${version}-…`; no shipped name has beta, RC or a build hash.
- `REMOTE_PROTOCOL_VERSION` stays 1, which 1.4.3 phones send, and `unsupported-version` stays the refusal code.

## A66 · The build diary

It's written at F11's close, from the OXE ledger, the scorecard, the sign-off file and the retro.
- **The index:** `docs/build-diary/README.md` links `f1.md` to `f11.md`.
- **Each page has five parts:**
  1. the title, `# F<n> · <name>`;
  2. one line with cost, CRs and duration;
  3. "What changed", at most 5 bullets;
  4. "CRs", as a table;
  5. "Lessons", at most 3.
- **Never in it:** secrets, home paths or e-mail addresses (redactSecrets plus the two patterns run over every page). People are named only by role.

## Contract (FRONTEND's names)

**Channels:**
- `IPC_CHANNELS.featureUsage = { state, setEnabled, export, clear, record, changed }`. `export()` opens the save dialog in main and returns `{ path } | null`.
- `IPC_CHANNELS.hostsProxy = { state, setEnabled, clear, retry, changed }`.

**MCP:** both groups are forbidden (they're the person's settings). They're never in `REMOTE_COMMANDS`.

**C3 codes:** `hostsProxy.portInUse`, `hostsProxy.failed`.

## SECURITY (TECH LEAD)

The review surface is the proxy:
- loopback only;
- no interception;
- no blocking;
- nothing beyond host and port is stored;
- per-origin credentials;
- it applies only to new agents;
- a failure leaves agents without it, never broken.

## Out of F11

Sending usage anywhere, blocking hosts, a diary viewer in the app, and a changelog beyond 1.5.
