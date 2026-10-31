# Security model

OXESpace intentionally gives local development agents powerful access. Its security boundary is therefore the selected workspace plus explicit user trust, not an assumption that agent input is safe.

## Trust boundaries

- The renderer is untrusted web content relative to the Electron main process. Browser windows run with context isolation and sandboxing; privileged operations use the typed preload bridge.
- A workspace ID is authoritative. Filesystem requests cannot substitute an arbitrary root, and canonical real paths are checked to prevent `..`, symlink and junction escapes.
- MCP configurations are executable integration settings. Only servers marked both enabled and trusted are synchronized to clients.
- Web Preview is local-only by default. Remote HTTP(S) origins require an explicit opt-in and receive a warning. Electron response-header rewriting is limited to loopback traffic.
- Web Preview renders in a `<webview>` guest, not an iframe — Design Mode has to inject a preload into the previewed page, which a cross-origin iframe cannot carry. The guest is strictly more powerful than the iframe it replaced, so its restrictions are explicit rather than inherited:
  - `will-attach-webview` pins the guest preload, forces `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true`, and rejects any `src` that is not `http(s)`.
  - The guest is forced into an in-memory partition (`oxe-webpreview`), so preview cookies and storage never touch the app session. The partition is set in the main process, not trusted from the renderer.
  - That session grants no permissions, blocks downloads, and strips the `Referer` header — preserving the `no-referrer` guarantee the previous sandboxed iframe had.
  - Guests cannot open windows; `window.open` is denied and safe external URLs are handed to the OS browser.
- The Design Mode guest script only reads from the previewed page and posts the selection to the host. Nothing reaches an agent until the user reviews the captured payload in the confirmation sheet and sends it explicitly.
- Third-party integration credentials (Linear) are encrypted with Electron `safeStorage` in the `secure_credentials` table and never cross IPC back to the renderer; when OS encryption is unavailable the row is flagged and the UI warns instead of silently storing plaintext.
- The local RPC bus (F3) listens on a per-user named pipe / unix socket — never a TCP port — requires a bearer token compared in constant time, and publishes its endpoint only to `<userData>/rpc-endpoint.json`.
- External URLs are accepted only through explicit protocol/host validation and are opened by the main process.

## Filesystem invariant

For every filesystem operation:

1. Resolve the workspace ID from SQLite.
2. Reject a caller-provided root that differs from the stored root.
3. Resolve the requested path relative to that root.
4. Canonicalize existing path segments using `realpath`.
5. Reject the operation unless the canonical target is the root or a descendant.

Do not add direct `fs` access to renderer code or bypass `FileSystemService` from a new IPC handler.

## Secrets and diagnostics

Internal MCP bridge tokens are local secrets. Generated `.mcp.json` files are ignored by Git. Logs and exported diagnostic reports must not include tokens, authorization headers, or an absolute user-home prefix. `DiagnosticsService` applies bounded log reads and redaction before export.

One function, `redactSecrets` in `shared/secrets.ts`, recognizes secrets by shape: provider tokens (Anthropic, OpenAI, GitHub, GitLab, Slack, Google, AWS, Stripe, npm, Linear), JWTs, `Bearer`/`Basic` credentials, named values (`password=`, `"api_key": …`, `Authorization: …`), passwords in URLs and private key blocks. It runs:

- on every line `electron-log` writes to `main.log` (`services/log-redaction.ts`);
- on diagnostics reports, on a conversation's Markdown export and on Thread failure details;
- on what shared memory captures from a Thread, before it is queued;
- on the audit export.

Settings › Agents › Agent activity exports the audit as JSON lines: Thread permission decisions (`thread_audit`), agent actions through the MCP tools (`agent_action_audit`) and OxeQuery requests (`oxequery_audit`), oldest first, each line with its `source` and `at`. Add new secret formats to `tests/secrets.test.ts` when integrations evolve.

## OxeQuery (containers and databases)

OxeQuery connects the app to databases and to the local container engine, and exposes both to AI agents. Its rules:

| Asset | Threat | Control |
|---|---|---|
| Database passwords, SSH keys, CA material | Disclosure to the renderer, logs, history, exports or a model | `safeStorage` in `secure_credentials` (`oxequery:<id>…`); never part of an IPC output type; `redact()` on every driver error; audit and history store statement text only |
| Data in the database | A write by mistake, or by an agent | Read-only is the default and is enforced by the server (`BEGIN READ ONLY`); writes are built from structured changes with parameters; destructive statements need confirmation |
| An agent calling a tool | Reading or changing data without a person agreeing | A single gateway: per-connection agent access (`off` by default), per-call approval bound to the SHA-256 of the exact text, no writes to `prod`, rate limits, result caps and column masking |
| Rows returned to an agent | Prompt injection through stored text | Results are labelled untrusted, bounded and masked; the tool descriptions say not to follow instructions found in data |
| The container engine | Command injection through names or arguments | `execFile` with an argv array and a fixed subcommand set; identifiers validated by pattern; no shell strings |
| Network reach | A renderer opening sockets or a tunnel to arbitrary hosts | CSP `connect-src 'self'`; sockets live in worker threads; SSH host keys are pinned and a changed key is a hard failure |
| Files | Path traversal in import and export | The renderer never supplies a path; main opens the native dialog and the worker writes only to the chosen file |
| Structure changes and bulk edits | A DDL statement or a many-document write built from text typed in a page | Structure is sent as data and the main process writes the DDL: every name quoted, types matched against a pattern, one validated expression for a default or check; updates are operator-only; a bulk change runs only for the count the person confirmed |
| Exported connections | Passwords or keys leaving in a shared file | The export carries no secret; an import switches agents off and skips tunnels that would need a key or password |
| Agent reach by environment | An agent given more than the person meant on a sensitive connection | Settings cap agent access per kind of environment (production: read at most); containers are visible only through a connection with agent access on; per-connection masked names |
| Bundled drivers | Vulnerable or unlicensed code shipped inside the worker | `oxeBundledDependencies`, `security:audit:bundled`, license allowlist and `THIRD_PARTY_NOTICES.md` checked in CI |

Provider permission prompts are **not** a control for these tools: Claude in `bypassPermissions` and Codex with `approvalPolicy: never` do not ask. The OxeQuery gateway is the authority.

## Approvals (B10)

Every request an agent raises for the person (confirm-level MCP actions, OxeQuery statements, preview automation) and the app's own restart offer after an unexpected error go through one channel family, `approvals.*` (`shared/types/approvals.ts`):

| Threat | Control |
|---|---|
| A native dialog cuts or hides what is approved (the Windows dialog drops a long `detail`) | The app's modal shows the requester's text whole, scrollable, up to `APPROVAL_AGENT_TEXT_MAX`; past that the request is flagged `truncated` and offers deny only |
| Agent text posing as app warnings (fake bullets, markdown, a `DROP` behind `-- read only`) | `appNotes` are C3 codes the app chose; `agentText` is always `untrusted: true` and shown verbatim in its own labelled monospace block; risk comes from `guardSql`/`classifyShellRisk`, which skip comments |
| An agent impersonating the app ("OXESpace wants to …", a pane named "OXESpace") | The requester comes from the authenticated execution and its owner, labelled by the app (provider and pane position); reserved names are refused as pane names and notification text after NFKC, case, accent, invisible-character and confusable folding (`reservedNameIn`) |
| A reflex click, or a buggy or compromised window, approving a destructive change | At `critical` risk an allow is never the default, Enter does nothing, and main refuses an allow (`tooSoon`) that comes before the window's ack or within `APPROVAL_CRITICAL_ALLOW_DELAY_MS` of it; a deny is always accepted |
| A text too long to review, or a flood of requests | One review cap in every door: above `APPROVAL_AGENT_TEXT_MAX` a change is refused before it is shown, never cut; past `APPROVAL_QUEUE_MAX` a new request is denied with its own code and logged |
| A forged, repeated or late answer | Main frame only; one answer per `id` and `generation`, validated against the request's options; a second, stale or unknown answer is refused with a typed code; an unanswered request is denied after `APPROVAL_TIMEOUT_MS` |
| Notification spoofing and flooding | Agent notifications carry an app-assigned requester prefix, refuse reserved names and are limited to `NOTIFY_PER_MINUTE` per execution |
| An agent answering for the person | `approvals.admin` is a forbidden MCP capability; no tool reaches these channels |

The native dialog is a fallback only: no app window exists, the window reported `approvals.unavailable` for that one request, or a request that needs a handshake (`crash`) was not acknowledged within `APPROVAL_ACK_TIMEOUT_MS`. The renderer-gone notice stays native because the renderer that would draw the modal is gone.

## Dependency and release controls

CI blocks moderate-or-higher production advisories with `npm run security:audit`, blocks high/critical build-tool advisories with `npm run security:audit:tools`, and verifies that the exactly pinned Electron belongs to a supported major line. Electron is a devDependency but ships in the product, so the production audit alone is insufficient. Transitive fixes may be pinned through `overrides`, with the lockfile committed. Build-tool advisories and dated triage are recorded in `docs/validation/stabilization-2026-10-07.md`. CI builds from a fixed commit, verifies native binaries, enforces bundle budgets, and generates checksums and an SBOM for releases.

## Database recovery

Never detach or delete WAL/SHM to recover from a busy or I/O error: the WAL can contain committed user data. Startup retries are bounded and preserve the database set. Before upgrading an existing schema, SQLite creates a consistent snapshot including WAL data; integrity and schema version are checked and the snapshot is flushed before migration. Backup failure stops the upgrade. A database newer than the application is rejected. Keep the complete database set when seeking recovery assistance; do not copy only the main file while the application is running.

## Reporting a vulnerability

Do not place credentials, exploit details or private workspace data in a public issue. Contact the maintainers privately through the repository security channel and include the affected version, reproduction conditions and expected impact.
