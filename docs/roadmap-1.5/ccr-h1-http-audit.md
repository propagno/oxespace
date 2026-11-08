# CCR: F3 backend — H1 (agent HTTP capture, A58/A59), H2's data, the A10 rework and the R18 badge (1.5.0)

- **Owner:** BACKEND.
- **Source:**
  - `.claude/roadmap-1.4/team/plans/1.5.0-cockpit-direction.md` §AUDITAR (H1, H2, A10/A11);
  - DESIGN's `1.5.0-f3-design.md`, whose "Data each screen needs from main" is this CCR's contract, agreed with DESIGN on 08/11.
- **Criteria:** A10, A58, A59, R18.
- **Built by:** the OXE executor.
- **SECURITY review:** mandatory (TECH LEAD), on the capture and redaction rules and the `http://` / `--insecure` flags.
- **Task list:** `.claude/roadmap-1.4/team/plans/f3-tasks-BACKEND.json`.
- **Frozen tests:** `tests/acceptance/f3/`, lint-clean, red for the right reason today.

## H1-1 — The forwarder keeps big events (A58)

`resources/agent-hooks/oxespace-status-hook.cjs` reads at most 1 MiB of stdin today. Past that, `JSON.parse` fails and the event is lost; the server also caps bodies at 1 MiB.
- **Read up to 8 MiB.** For a `PostToolUse` of `Bash` (Claude) or `shell` (Codex), shrink `tool_response` to `{ stdoutHead (4 KiB), stderrHead (4 KiB), interrupted, error?, truncated, keptBytes, totalBytes }`, and cut `tool_input.command` to 8 KiB. The body then stays under the server's 1 MiB.
- **Past 8 MiB:** recover `hook_event_name`, `tool_name`, `tool_use_id`, `session_id` and `cwd` from the first 64 KiB, and send them with `tool_response: { truncated: true, keptBytes: 0 }` and no `totalBytes`.
- **A small event passes unchanged.** Every path still ends in `{}` and exit 0.

## H1-2 — Reading HTTP calls out of a command (A59)

`electron/main/services/http-audit/parse.ts`:
- `parseHttpCalls(command, shell = 'bash')` → `HttpCall[]`.
  - **Bash:** tree-sitter `parseShell` splits the simple commands, and each `curl`, `wget`, `http`/`https` (HTTPie) or `xh` becomes a call.
  - **PowerShell:** a regex tokenizer for `Invoke-WebRequest` and `Invoke-RestMethod`.
- **Kept:** tool, method, scheme, host, port, the path through `pathTemplate` (numbers, UUIDs and ≥16-character hex become `:id`), query KEYS, and header NAMES (sensitive ones as `•••• (NAME)`). Also `hasBody`, `bodyBytes`, `insecure` (`-k`/`--insecure`, `-SkipCertificateCheck`), and `plainHttpExternal` (`http://` to a host that isn't loopback).
- **Never kept:** a header value, a query value or a body.
- **`statusFromOutput(stdoutHead)`:** the status comes from an `HTTP/x NNN` status line or a trailing `-w '%{http_code}'`, otherwise null.

## H1-3 — `agent_http_audit` (migration 094)

**The number:** origin/main's highest migration is 093 on 08/11. It's re-checked before execute, renumbered if another lands first, with `EXPECTED_SCHEMA_VERSION` bumped in `tests/integration/migrations.test.ts`.

**Columns:**
- id, ts, actor (`pane:<id>` | `thread:<id>`), workspace_id, agent, session_id, source (`hook` | `rollout`);
- tool_use_id, call_index, tool, method, scheme, host, port, path_template;
- query_keys_json, header_names_json, has_body, body_bytes;
- status, duration_ms, insecure, plain_http_external, command_redacted, output_truncated.

**Constraints:**
- **Append-only:** a no-update trigger, like 070/078.
- **`UNIQUE (tool_use_id, call_index)`:** one command can hold several calls. The plan's `tool_use_id UNIQUE` can't hold those; this keeps its point, no duplicate between the hook and the rollout.
- **Indexes:** `(ts DESC)` and `(workspace_id, ts DESC)`.

**`electron/main/services/http-audit/store.ts`, `HttpAuditLog(db, now?, deps?)`:**
- `ingest({ paneId, workspaceId, agent, sessionId, at, record, source? })` → rows added. It never throws.
- **Duration:** from the PreToolUse→PostToolUse pair of a `tool_use_id`, kept in memory, otherwise null.
- **`command_redacted`:** `redactSecrets` (`shared/secrets.ts`), plus header values and URL query values masked, cut to 512 characters.
- **Never stored:** stdout.
- `prune(now?)` keeps 90 days (`HTTP_AUDIT_RETENTION_DAYS`) and at most 50,000 rows, newest first (`HTTP_AUDIT_MAX_ROWS`). It runs at startup and daily.

## H1-4 — The hook server feeds the audit

`AgentHookServer` gains `httpAudit?: { ingest(input) }`. For every authenticated event, after `mapHookEvent`, it calls the audit inside a try/catch, so a failing audit never touches the pane status. `index.ts` wires `HttpAuditLog` in.

## H1-5 — The Codex rollout fallback (deferred)

It's in the plan, but it isn't frozen here: it needs a real Codex rollout fixture to read `exec`/`shell` calls from. The store already freezes the rule that a rollout row of a `tool_use_id` the hook stored is ignored. A follow-up CCR adds the reader with its fixture.

## H2-data — The HTTP calls panel and the Network tab

`HttpAuditLog.list({ workspaceId, view?: 'all' | 'errors' | 'flagged', filter?, cursor?, limit? })` → `{ rows, cursor, hosts: [{ host, count, production }] }`.
- **Paging:** 50 newest first.
- **Errors:** no status, or 400 and up.
- **Flagged:** production or `insecure`.
- **filter:** matches host or path, case-insensitively.
- **production** is computed at read time by `deps.isProductionHost(workspaceId, host)`, which `index.ts` builds from the workspace Policy and the OxeQuery production connections. No new setting.
- **IPC:** `http-audit:list`, excluded from MCP.

## A10 — Agent activity, four sources

This supersedes #650's F2 design, where the post source is gone.
- **Sources:** `changes`, `databases`, `containers`, `http`.
- **Paging:** each source runs its own bounded statement (`INDEXED BY` its ts index, `LIMIT` the page plus 1), and main merges the results by `(at desc, source order, id desc)`. That gives pages of 50 with an opaque cursor.
- **Partial failure:** a source whose statement throws is listed in `failedSources`, and the rest come back. This is DESIGN's partial-failure Notice.
- **Row:** `{ id, source, at, actor { kind, id, name, gone }, agent, workspaceId, summary, target, write, decision, outcome, errorCode, detailRef }`. The renderer maps decision and outcome to its own chips.
  - An http row reads `METHOD host/path_template`, targets the host, and is a write unless GET/HEAD/OPTIONS. A status of 400 or more is outcome `error`.
- **`detail(id)`** returns the stored fields, plus `production` for http.
- **Query:** `{ sources?, agent?, workspaceId?, since?, until?, view?, actor?, connection?, cursor?, limit? }`.
- **Methods:** `listStatements(query)` exposes the per-source SQL for the frozen plan check.
- **IPC:** `agent-activity:list`, `:detail` and `:badge`, all excluded from MCP.

## R18 — The badge

`badge({ connectionId })` → `{ today, waiting }`.
- **today:** this connection's databases and containers rows since local midnight.
- **waiting:** an approval pending for that connection right now (`deps.pendingFor`, from the approval center).

## Frozen tests

- `h1-forwarder.test.ts`
- `h1-http-parse.test.ts`
- `h1-http-audit.native.test.ts`
- `h1-hook-server-ingest.test.ts`
- `h2-http-list.native.test.ts`
- `a10-agent-activity.native.test.ts`

All are lint-clean and red for the right reason. The checks that pass today (a small event unchanged, an unauthenticated event refused, a throwing audit leaving the status intact) are behaviour that must stay.
