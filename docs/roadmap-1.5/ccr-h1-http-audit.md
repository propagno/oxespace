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

## SECURITY rules (TECH LEAD S1–S7, HML-695-1..3), all frozen

`parse.ts` also exports:
- `redactCommand(command, shell)` — the text the store keeps before the 512 cut;
- `isSensitiveHeaderName(name)`;
- `HTTP_CALLS_MAX` = 50, the most calls read from one command.

The shell is chosen by `tool_name`: `PowerShell` → powershell, otherwise bash.

**What is never kept, in any column, list row or detail:**
1. **S1 — body values:**
   - curl `-d`/`--data`/`--data-raw`/`--data-binary`/`--data-urlencode`/`--json`;
   - curl `-F`, including `@file` paths;
   - HTTPie `field=value` and `field:=json`;
   - Invoke-* `-Body`.
   Only `has_body` and `body_bytes` are kept.
2. **S2 — credential flags:**
   - curl `-u`/`--user`, `--oauth2-bearer`, `-b`/`--cookie`, `-E` cert:pass, `--proxy-user`;
   - wget `--password`, `--http-password`, `--header` values;
   - HTTPie `-a` and `Header:value` items;
   - Invoke-* `-Credential`, `-Token`, and `-Headers @{…}` values.
   In `command_redacted` each value becomes `••••`.
3. **S3 — URL userinfo:** `https://user:pass@host` keeps the host; the userinfo leaves the host and the command.
4. **S4 — secrets in the path:** a path segment of ≥ 20 characters of `[A-Za-z0-9_\-:.]` that mixes letters and digits becomes `:secret`, in `path_template` and in `command_redacted`. This covers Slack webhooks, Telegram bot tokens and keys in the path. Numbers, UUIDs and long hex stay `:id`.
5. **S5 — stdout and stderr reach no table:** `hook-pipeline.ts` exports `hookServerOptionsFor({ db, authenticate, onStatus, onLocation?, now? })`, the one place that builds the hook server's options and every database write on the hook path. `index.ts` must use it, and `h1-pipeline-wiring.test.ts` freezes that (TECH LEAD's condition):
   - every `new AgentHookServer(` in electron/main takes `hookServerOptionsFor(`;
   - only `http-audit/store.ts` inserts into `agent_http_audit`;
   - only the pipeline and the rollout reader call `.ingest(`, so the server's `httpAudit` option is a structural interface, not `HttpAuditLog`.
   The sweep scans every table after an event.
6. **S6 — inline environment secrets:** `NAME=value cmd` and `export NAME=value && …` values are masked.
7. **S7 — sensitive header names:** Authorization, Proxy-Authorization, Cookie and Set-Cookie, plus any name containing token, secret, key, auth, session, signature, password or credential, case-insensitive.

**HML-695-2/3:**
- **Wrappers:** `sudo`, `env`, `time`, `command` and `timeout`, and `bash -c`/`sh -c`, are read through.
- **A variable URL** (`curl "$API_URL/x"`) never throws; its host is null or the literal.
- **Windows:** `curl.exe`, and the PowerShell aliases `iwr` and `irm`.

## H1-5 — The Codex rollout fallback (in F3, TECH LEAD 08/11)

`electron/main/services/http-audit/codex-rollout.ts` exports `ingestCodexRollout(log, { file, paneId, workspaceId, sessionId })` → rows added, and it never throws.
- **Reads** `response_item` lines of `function_call` named `shell` (`arguments.command`, an argv; a `bash -lc` script is unwrapped) and of `local_shell_call` (`action.command`).
- **Pairs** each call with its `function_call_output` by `call_id`: the status comes from the output text, and the duration from `metadata.duration_seconds`.
- **Stores** with `source: 'rollout'` and `agent: 'codex'`, under the same masking. The `tool_use_id` is the call_id, so neither a re-read nor a call the hook already stored adds a row.
- **The frozen fixture is synthetic,** written from Codex's published rollout shape; no live Codex run.
- **When it runs:** after a Codex turn in a pane, using the rollout path the pane's recorded session points to (`findCodexRollout`, as native-session-history does).

## H2-data — The HTTP calls panel and the Network tab

`HttpAuditLog.list({ workspaceId, actor?, view?: 'all' | 'errors' | 'flagged', filter?, cursor?, limit? })` → `{ rows, cursor, hosts: [{ host, count, production }] }`.
- **Paging:** 50 newest first.
- **Errors:** no status, or 400 and up.
- **Flagged:** production, `insecure` (shown as "TLS not checked") or `plain_http_external` (shown as "Not encrypted"); DESIGN M5.
- **actor:** the Network tab's filter to one conversation or pane (`pane:<id>` | `thread:<id>`, at most 200 characters), applied in main, summary included (DESIGN M5).
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
