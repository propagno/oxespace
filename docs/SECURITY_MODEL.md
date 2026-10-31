# Security model

OXESpace intentionally gives local development agents powerful access. Its security boundary is therefore the selected workspace plus explicit user trust, not an assumption that agent input is safe.

## Trust boundaries

- The renderer is untrusted web content relative to the Electron main process. Browser windows run with context isolation and sandboxing; privileged operations use the typed preload bridge.
- A workspace ID is authoritative. Filesystem requests cannot substitute an arbitrary root, and canonical real paths are checked to prevent `..`, symlink and junction escapes.
- MCP configurations are executable integration settings. Only servers marked both enabled and trusted are synchronized to clients.
- Web Preview is local-only by default. Remote HTTP(S) origins require an explicit opt-in and receive a warning. Electron response-header rewriting is limited to loopback traffic.
- An agent's `oxespace_open_web_preview` (B15) is confirm level unless the URL is local. http(s) to `localhost`, `*.localhost`, `127.0.0.1` or `[::1]` on any port, with the host written the way the URL parser writes it, opens as before. Any other host waits for the person to approve that exact URL through the approval broker; nothing is queued until then. Every other scheme is refused without asking, `file:` included: the preview loads http(s) only, so asking for an approval that could not lead anywhere would only spend one (opening a file after an approval is a post-1.4 item). Other spellings of a loopback address (`http://2130706433`, `http://0177.0.0.1`, `http://LOCALHOST`, `http://[::ffff:7f00:1]`) and credentials in the authority (`http://127.0.0.1@evil.com`) ask, since they exist to slip past a check (`electron/main/utils/preview-url.ts`). The preview's own guards (External preview, http(s) only) still apply after an approval.
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
- on diagnostics reports, on a conversation's Markdown export and on OxeChat failure details;
- on what shared memory captures from an OxeChat conversation, before it is queued;
- on the audit export.

Settings › Agents › Agent activity exports the audit as JSON lines: OxeChat permission decisions (`thread_audit`), agent actions through the MCP tools (`agent_action_audit`) and OxeQuery requests (`oxequery_audit`), oldest first, each line with its `source` and `at`. Add new secret formats to `tests/secrets.test.ts` when integrations evolve.

## OxeQuery (containers and databases)

OxeQuery connects the app to databases and to the local container engine, and exposes both to AI agents. Its rules:

| Asset | Threat | Control |
|---|---|---|
| Database passwords, SSH keys, CA material | Disclosure to the renderer, logs, history, exports or a model | `safeStorage` in `secure_credentials` (`oxequery:<id>…`); never part of an IPC output type; `redact()` on every driver error; audit and history store statement text only |
| Data in the database | A write by mistake, or by an agent | Read-only is the default and is enforced by the server (`BEGIN READ ONLY`); writes are built from structured changes with parameters; destructive statements need confirmation |
| An agent calling a tool | Reading or changing data without a person agreeing | A single gateway: per-connection agent access (`off` by default), per-call approval bound to the SHA-256 of the exact text, no writes to `prod`, rate limits, result caps and column masking |
| The person's open transaction | An agent's read closing or joining the person's session, so the transaction is rolled back silently and the next statement autocommits (B14) | Worker sessions are kept per connection and role (`person` / `agent`); a session with a transaction open or a command running is never closed by a settings change (`conflict`); an agent's timeout cancels only the agent's backend or operation; the worker is restarted only when no person session is at risk. See `docs/OXEQUERY.md`, *Sessions in the worker* |
| Rows returned to an agent | Prompt injection through stored text | Results are labelled untrusted, bounded and masked; the tool descriptions say not to follow instructions found in data |
| The container engine | Command injection through names or arguments | `execFile` with an argv array and a fixed subcommand set; identifiers validated by pattern; no shell strings |
| Network reach | A renderer opening sockets or a tunnel to arbitrary hosts | CSP `connect-src 'self'`; sockets live in worker threads; SSH host keys are pinned and a changed key is a hard failure |
| Files | Path traversal in import and export | The renderer never supplies a path; main opens the native dialog and the worker writes only to the chosen file |
| Structure changes and bulk edits | A DDL statement or a many-document write built from text typed in a page | Structure is sent as data and the main process writes the DDL: every name quoted, types matched against a pattern, one validated expression for a default or check; updates are operator-only; a bulk change runs only for the count the person confirmed |
| Exported connections | Passwords or keys leaving in a shared file | The export carries no secret; an import switches agents off and skips tunnels that would need a key or password |
| Agent reach by environment | An agent given more than the person meant on a sensitive connection | Settings cap agent access per kind of environment (production: read at most); containers are visible only through a connection with agent access on; per-connection masked names |
| Bundled drivers | Vulnerable or unlicensed code shipped inside the worker | `oxeBundledDependencies`, `security:audit:bundled`, license allowlist and `THIRD_PARTY_NOTICES.md` checked in CI |

Provider permission prompts are **not** a control for these tools: Claude in `bypassPermissions` and Codex with `approvalPolicy: never` do not ask. The OxeQuery gateway is the authority.

### Closed findings

| Finding | Status | What it was | Why Postgres runs it | Control now | Test |
|---|---|---|---|---|---|
| SQL classifier: dollar quote after an identifier (B10, #237) | **Closed** | `SELECT foo$a$ FROM t; DROP TABLE users; --$a$` was classified as a plain **read**. The classifier (`sql-guard.ts`) opened a dollar quote at the `$a$` after `foo`, read everything up to the second `$a$` as a string, and never saw the `;` or the DROP. A read skips the destructive confirmation in the workbench, and an agent's `oxespace_db_query` accepts it (that call still runs on a read-only connection, so the server refuses the DROP there). | Identifiers may contain `$` after their first character, and a dollar quote that follows an identifier must be separated from it by whitespace. So Postgres reads `foo$a$` as one column name, ends the statement at `;`, runs `DROP TABLE users`, and treats `--$a$` as a comment. | `dollarTag()` opens no dollar quote right after an identifier character (letter, digit, `_` or `$`), as Postgres does. Both the tokenizer and `outsideReach` use it. The tag rule itself (`$$`, `$[A-Za-z_]*$`) is unchanged. | `tests/unit/oxequery-sql-risk.test.ts`, "does not open a quote right after an identifier, as Postgres does not": `foo$a$ … DROP` and `x$$ … DELETE` are both destructive. |
| An agent's read closes the person's session (B14, BE-M-09) | **Closed** | The worker kept one session per connection, keyed by settings that included read-only, and the agent gateway forces read-only. An agent's `oxespace_db_query` on a connection the person was using looked like a settings change, so `openSession` closed the person's session: their open transaction was rolled back silently and their next statement ran in autocommit. MongoDB had the same path (a running import or export lost its client). An agent's timeout also cancelled whatever the shared session was running, and a stuck worker was restarted even with a person transaction open. | Closing a session ends its backend, and Postgres rolls back a transaction whose session ends. | Sessions per connection and role; read-only is no longer part of the session key; a busy session is never closed (`conflict`, `oxequery.session.busy`); an agent's session idles out after 2 minutes and holds no transaction; at most 3 driver connections per connection and role (`limit`); a timeout cancels only its own role's work; the worker restarts only when no person session is at risk. | `tests/unit/oxequery-session-roles.test.ts`, `tests/unit/oxequery-worker-client.test.ts`, live: `tests/live/oxequery-writes-live.test.ts` "an agent's read never closes the person's transaction". |
| An agent's read ran inside the person's open transaction (B14, BE-M-09) | **Closed** | With one session per connection, an agent read that arrived while the person had a transaction open ran on that same session. `pgRun` skips its own `BEGIN READ ONLY` wrapper when a manual transaction is open (the transaction is the person's to end), so the agent's `SELECT` ran inside the person's transaction and could see rows the person had not committed. | A statement sent on a session with an open transaction is part of that transaction; Postgres has no way to run it "outside". | The agent has its own session per connection (`role: 'agent'`), so its `BEGIN READ ONLY` wrapper always applies and it only ever sees committed data. An agent cannot keep a transaction of its own: a `BEGIN` it sends is rolled back and refused (`invalid`, `oxequery.session.agentTransaction`). | `tests/unit/oxequery-session-roles.test.ts` "an agent's read on the connection the person is using…": the agent's client log is exactly `BEGIN READ ONLY`, `SELECT`, `ROLLBACK`; live: `tests/live/oxequery-writes-live.test.ts` "an agent's read never closes the person's transaction…": the agent counts 0 before the person's `COMMIT` and 1 after. |
| An agent's timeout cancelled the shared session (B14, BE-M-09) | **Closed** | The gateway's time limit sent `sql.cancel` for the connection id, and the worker client's own time budget did the same (or a `close`). With one session per connection that was `pg_cancel_backend` on whatever the shared backend was running, including the person's statement. For MongoDB the gateway sent `sql.cancel`, which the worker answered with "no session running": a no-op, so a slow agent `find` was never stopped on the server. A worker that then failed a ping was restarted, dropping every connection and the person's open transaction with it. | `pg_cancel_backend` takes a backend pid, and the only pid the worker knew was the shared session's. | The agent's connection carries `role: 'agent'`, so `sql.cancel` resolves the agent's backend pid and `mongo.cancel` the agent's tagged operation (`killOp` plus the client-side abort); the gateway picks the op by engine, and the worker client's `expire()` stops only the request's own role (`sql.cancel`, `mongo.cancel`, or `close` of that role's slot). The worker is restarted only when it no longer answers a ping and no person session is at risk; a deferred restart is journaled as `incident.oxequery.restartDeferred`. | `tests/unit/oxequery-session-roles.test.ts` "an agent's timeout cancels the agent's backend, never the person's" and "…stops the agent's operation on the agent's client, while the person's import carries on"; `tests/integration/oxequery-agent.test.ts` "a timeout stops the agent only"; `tests/unit/oxequery-worker-client.test.ts` restart-rule cases. |
| Mongo write on production without the typed name (B15, FE-M-09) | **Closed** | `mongo.write` on a production connection ran with `confirmed: true` alone, a flag the window sets. SQL on production already needed the connection's name typed. The reasons were English sentences. | Not applicable: MongoDB has no notion of a production connection; the app does. | `checkMongoWrite()` (`oxequery-guard.ts`), in main: policy first, then on production the name must match (`nameMatches`, the same check as SQL) or the call is refused with `confirm-name`; a delete still needs its confirmation. Reasons and message travel as C3 codes (`oxequery.mongo.*`); the English stays for logs. | `tests/unit/oxequery-mongo-write.test.ts` |

## Files that steer agents (protected config)

Agent instructions (AGENTS.md, CLAUDE.md…), MCP settings (.mcp.json…) and hooks (.claude/settings.json, .git/hooks/…) are protected (`electron/main/services/conversation/kernel/protected-config.ts`). A change to one is never approved by a saved rule, the built-in lists, Full access or "allow for this session"; a person approves it once, or declines it. The names and places are two tables in that file (`PROTECTED_CONFIG_NAMES`, `PROTECTED_CONFIG_PLACES`), so a new protected file is one entry.

### Closed findings

| Finding | Status | What it was | Control now | Test |
|---|---|---|---|---|
| Saved program rules let a command write a protected file (B16, homologation's probe of #208) | **Closed** | A command was guarded only when it named the file as an argument of a known writer (`cp`, `tee`, `sed -i`…). With saved allow rules for the program, `python -c "open('AGENTS.md','w')…"`, `node -e "…writeFileSync('.mcp.json')…"`, `sh -c 'echo {} > CLAUDE.md'`, `powershell -c "Set-Content …"`, `curl -o`, `yq -i`, `npx tool --write`, `cd .claude && echo {} > settings.json`, and commands that rewrite tracked files without naming them (`git checkout --`, `git apply`, `tar xf`, `unzip -o`) were approved by the rule, and Windows spellings (`AGENTS.md.`, `AGENTS.md::$DATA`, `AGENTS~1.MD`) were not recognised. | A command that names a protected file anywhere in its text (arguments, redirects, `-c`/`-e` code, nested shells and quotes, after a `cd`, either slash, any case, relative or absolute) is guarded; only a plain read from the built-in safe list (`cat AGENTS.md`) is still answered. git checkout, switch, restore, apply, merge, rebase, reset, clean, am, cherry-pick, revert, pull, stash pop/apply and archive extraction (tar x, unzip, 7z x, Expand-Archive) are never rule-approved; git commit, push, add, status, diff, log, fetch and branch still are. Paths resolve Windows aliases: trailing dots and spaces, alternate streams, 8.3 short names. Changes made outside the app's write path (another program, a script the agent left behind) are not seen by this check; **B7.4's file watch** is the general fix for those. The rewriters are guarded in every git project (every one has `.git/hooks`); guarded asks once and never blocks. Once B7.4 watches the files, it catches the result instead of guessing from the command, and the rewriters can become rule-approvable again. | `tests/unit/protected-config.test.ts`, "commands that reach protected files (B16)" and "Windows spellings of a protected file (B16)" |
| Codex could offer "for the session" for a guarded request (P1-17) | **Closed** | Claude's card left it out for protected files, but Codex lists its own decisions, and a command such as `tee .mcp.json` that the shell asked about for another reason was not marked guarded. | A guarded request offers accept-once or decline on every provider; a session answer that arrives anyway is refused (`thread.request.guardedDecision`) and the request stays pending. | `tests/unit/protected-config.test.ts`, "a guarded request on the Codex path (P1-17)" |

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

### Reserved names (`reservedNameIn`, `shared/reserved-names.ts`, re-exported by `shared/approval-rules.ts`)

A pane name an agent chooses, and the agent-supplied parts of a notification, may not pass for the app, the operating system or a vendor. Both folds apply to every rule: symbols dropped ("System!") and symbols read as the letters they imitate ("$ystem", "W1ndows"), after NFKC, case, accents, invisible characters and look-alike letters.

| Names | Refused when |
|---|---|
| OXESpace, OxeChat, OxeCode, OxeQuery, OxePod, OxePost | contained anywhere in the whole-name fold ("OXESpace: security update", "O.X.E Space") |
| Windows, Microsoft, Ubuntu, Linux, macOS, Apple, Google, GitHub, Debian, Fedora, GNOME, KDE, polkit | a whole word of the name, or two adjacent words joined ("Windows Security", "GNOME Keyring", "Win dows", "Git Hub"); "Linuxbrew", "Applesauce", "Gnomes", "kdenlive" and "Win dow manager" are allowed |
| System, Sistema, Administrator, Administrador, Admin, Aplicação, Aplicativo, Application, App, root, sudo, Security, Segurança | the first word, or the whole name ("System Administrator", "root access", "Security scanner", and so also "Sistema de testes" and "App builder"); "my system", "filesystem", "Rootless builder", "pseudo", "my security notes" and "Securities" are allowed |
| Admin…, Oxe… (prefixes, folded) | a first word that starts with one ("Administração", "Admins", "OxeBot", "OXE", "Oxentebot"); "Admiral", "Admit", "Ox" and "Boxer" are allowed, and the real words Oxente, Oxen and Oxeye are allowed exactly as the first word, whatever follows ("Oxente bot") |
| Thread, Code, Chat (the app's tab names) | the whole name only; "Code reviewer" and "Chatbot" are allowed |

The first-word and prefix rules also read the first two words joined, so "Sys tem", "Ad min panel" and "OX E" are refused ("Ox ente" joins to the allowed "oxente"; "Box er" to "boxer"). Some names are refused although a person could mean something harmless ("Security Reviewer", "Root Cause Analyst", "Admin Panel", "Adminer", "Administrativo", "Gnome lover", "Fedora fan", "GitHub Copilot"); that overblock is accepted.

Provider names (Claude, Anthropic, Codex, OpenAI) are allowed: the requester the person sees comes from the authenticated provider, never from the name. Each rule is checked on both folds before the next rule, so the most specific name is reported.

Words are split on anything that is not a letter; a run of three or more single letters, whatever separates them ("W i n d o w s", "W.i.n.d.o.w.s", "W_i_n_d_o_w_s"), is joined into one word first, while two ("A B testing") are left alone. A pane name is refused with `agents.name.reserved` (MCP code `reserved-name`), a notification with `notify.refused.reservedName`.

**Closed findings (homologation, #184 and #247):** "Administração" got through #247's first version (only whole first words were matched); the admin prefix closes it.

**Closed finding (homologation, #184):** a black-box probe of #235's `reservedNameIn` with 38 names caught every imitation of the product names, but let through "System Administrator", "Sistema operacional", "Administrador", "Aplicação", "Windows", "Windows Security", "Microsoft", "Ubuntu" and "Thread": the generic words were matched only as the whole name and there were no OS or vendor names. The rule above closes it; `tests/approval-rules.test.ts` keeps each of those names, and the probe's categories, with its verdict.

## Accepted risks

Risks known and accepted for a release, each with what limits it and when it is looked at again.

| Risk | Why it is accepted | What limits it | Revisit |
|---|---|---|---|
| None open for approvals. (Closed in #238: a `critical` approval in the system dialog had no 2-second hold on Allow; the native fallback is now deny-only for critical requests, with `approvals.note.nativeCriticalDenyOnly`, and an allow it returns anyway counts as deny.) | | | |

## Dependency and release controls

CI blocks moderate-or-higher production advisories with `npm run security:audit`, blocks high/critical build-tool advisories with `npm run security:audit:tools`, and verifies that the exactly pinned Electron belongs to a supported major line. Electron is a devDependency but ships in the product, so the production audit alone is insufficient. Transitive fixes may be pinned through `overrides`, with the lockfile committed. Build-tool advisories and dated triage are recorded in `docs/validation/stabilization-2026-10-07.md`. CI builds from a fixed commit, verifies native binaries, enforces bundle budgets, and generates checksums and an SBOM for releases.

## Database recovery

Never detach or delete WAL/SHM to recover from a busy or I/O error: the WAL can contain committed user data. Startup retries are bounded and preserve the database set. Before upgrading an existing schema, SQLite creates a consistent snapshot including WAL data; integrity and schema version are checked and the snapshot is flushed before migration. Backup failure stops the upgrade. A database newer than the application is rejected. Keep the complete database set when seeking recovery assistance; do not copy only the main file while the application is running.

## Reporting a vulnerability

Do not place credentials, exploit details or private workspace data in a public issue. Contact the maintainers privately through the repository security channel and include the affected version, reproduction conditions and expected impact.
