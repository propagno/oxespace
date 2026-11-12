# CCR: F11 backend — the usage count, the outgoing hosts proxy, what ships, the build diary (1.5.0)

Owner: BACKEND. Status: frozen tests; TECH LEAD (SECURITY S1–S6) and DESIGN approved; HML 724-1..5 in.

**Criteria:**
- **With backend work:** A65 (N7), A68 (H4), A39 and A41 (what ships, as guards) and A66 (N8).
- **The window's or the release's, on what's on main:**
  - A40, the downgrade screen (T87);
  - What's new, from the renderer catalog;
  - the updater's copy, and its wait during a critical approval, which is the window's own (FRONTEND);
  - A3: baselines and verify (SRE/HML).

**Contract:** DESIGN's `1.5.0-f11-design.md` "Data each screen needs", with FRONTEND's names (08/11).

**Frozen tests:** `tests/acceptance/f11/`: 25 tests in 4 files.

| File | Tests | Runs on |
|---|---|---|
| `a65-usage-count.native.test.ts` | 5 | Electron's Node, a migrated DB, an injected clock, fetch watched |
| `a68-hosts-proxy.native.test.ts` | 13 | Electron's Node, real loopback sockets |
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

## A68 · The outgoing hosts proxy (SECURITY: TECH LEAD S1–S6, HML 724-1..5)

**Off by default.**

**Each agent start gets its own credential.** `grant(origin)` → `{ env, revoke }`.
- It sets `HTTP_PROXY`, `HTTPS_PROXY` and their lowercase forms, carrying a random secret that's kept in memory only.
- It also sets `NO_PROXY` and `no_proxy`: the person's own entries plus `localhost`, `127.0.0.1` and `::1`, so OXESpace's own servers never go through it.
- The agent revokes the credential when it ends.

**S1 · Not an open proxy.** No credential, a wrong one or a revoked one gets 407, and nothing is forwarded.

**S2 · Loopback only.** It binds 127.0.0.1 (or ::1) on a random port. A non-loopback interface can't connect.

**S3 · It never strands agents.**
- A crashed listener comes back on the same port within 2 s.
- If that port was taken meanwhile, the state is failed with `hostsProxy.portInUse { port }`, and Try again takes it back.
- Turning it off grants no new credentials, but it keeps serving the ones already granted as a silent pass-through (it logs nothing more) until the last one is revoked. Then it stops.

**S4 · The person's own proxy is never silently replaced.** If the person's environment already has a proxy variable, the state is failed with `hostsProxy.userProxy`, and nothing is granted.

**S5 · Limits.**
- An idle timeout, by default at least 10 minutes (for WebSocket, SSE and streamed responses).
- A cap on concurrent connections: past it, the answer is 503.
- Bodies are streamed, never buffered. A 64 MiB upload keeps memory growth under 32 MiB.

**S6 · Retention and audit.** The list keeps 90 days and at most a row cap. On, off and clear are audited in `person_action_audit` without content.

**What it does with traffic:**
- **CONNECT** is spliced byte for byte: no certificate, no TLS interception.
- **Plain HTTP** is streamed with `Proxy-Authorization` and `Proxy-Connection` removed, and everything else unchanged (HML 724-1).
- It never blocks a host. An unreachable target answers 502 and is still logged.

**Never stored or logged,** in the DB or the logger: a path, a query, a header value, a body or a credential (HML 724-2).

**A row** is keyed by (host, port, conversation): `{ host, port, count, lastSeen, firstSeen, conversationId?, conversationTitle? }`.

**For DESIGN's copy (HML):** Node's built-in fetch, ws clients and ssh/git@ ignore HTTP_PROXY. The panel should say "programs that use HTTP_PROXY", so the list isn't read as everything.

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

**C3 codes:** `hostsProxy.portInUse`, `hostsProxy.failed`, `hostsProxy.userProxy`.

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
