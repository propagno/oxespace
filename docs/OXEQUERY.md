# OxeQuery

OxeQuery is the third application mode (next to Code and Thread). It shows the
containers that run on this machine (Docker or Podman) and connects to
PostgreSQL and MongoDB, so a database and the container it runs in are one
click apart.

It is an original implementation. Beekeeper Studio was only a reference for what
such a tool should offer; no code from it is used (its Community Edition is
GPLv3 and its MongoDB support is commercial, while OXESpace is MIT).

## What it does

- **Containers**: every container the engine knows (running first) with state,
  published ports and a running / stopped / databases summary. Start, stop,
  restart, details (image, command, ports, networks, mounts, environment *names
  only*), live logs, run a command once, and an interactive shell. The sidebar
  lists them too, with a PG / Mongo tag on database images.
- **Engine discovery**: Docker or Podman is found on PATH, then in the usual
  install locations (Docker Desktop, Homebrew, `/usr/bin`, Podman installers).
  A stopped daemon, a missing CLI and a permission problem each get their own
  explanation, and the page keeps checking, so starting Docker Desktop is noticed
  without a restart.
- **Connections**: paste a `postgres://` or `mongodb://` string to fill the form,
  mark the environment (local / development / production), read-only by default,
  test before saving.
- **PostgreSQL**: schema tree with filter, table browse with paging and
  structure, multiple query tabs, SQL editor (Monaco), per-connection history,
  cancel, row limit, sortable grid, row details panel, copy as CSV / JSON.
- **MongoDB**: database and collection tree, `find` (filter, projection, sort,
  paging), `aggregate`, indexes, documents or a table view.
- **From a container**: **Query** on a Postgres or MongoDB container creates the
  connection (host, published port, user, database and password from the
  container's environment). The password goes straight to secure storage and is
  never shown.
- **Idle connections** are closed after 10 minutes and at most 12 stay open.

## Safety model

| Concern | Rule |
|---|---|
| Passwords | Stored through Electron `safeStorage` in `secure_credentials` (`oxequery:<id>`). If the OS cannot encrypt, saving a password is refused. Never returned to the renderer, never logged. |
| Writes | Connections are **read-only by default**. Read-only runs every statement in `BEGIN READ ONLY … ROLLBACK`, so the server refuses writes even when a statement hides one. |
| Destructive SQL | `DROP`, `TRUNCATE`, `DELETE`/`UPDATE` without `WHERE`, `ALTER … DROP` ask for confirmation. A `prod` environment is labelled. |
| MongoDB input | EJSON only (no `eval`). `$where`, `$function`, `$accumulator` are refused; `$out`/`$merge` are refused. |
| Containers | The CLI is called with an argv array and a fixed set of subcommands. Container ids must match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. "Run command" is an argv, not a shell string. |
| Shell | The renderer receives an opaque pane id. The command (`docker exec -it <id> sh`) is registered by the main process and cannot be supplied by the renderer. |
| Network | The renderer never opens sockets (CSP `connect-src 'self'`). Database traffic runs in a worker thread (`out/main/oxequery-worker.js`). |

## Architecture

```
Renderer (lazy chunk)        Main                              Worker thread
OxeQueryView  ── oxeQuery:call ──►  OxeQueryService  ──►  OxeQueryCore
ContainersPanel                      ContainerRuntime         pg + pg-cursor
SqlWorkbench / MongoWorkbench        ConnectionStore          mongodb + bson
             ◄── oxeQuery:event ──   (SQLite + safeStorage)
```

- One IPC command channel (`oxeQuery:call`) returns `{ ok, value | error }`, so
  the error code survives the process boundary. One event channel streams logs
  and container changes.
- The drivers are bundled into the worker and are `devDependencies`; they are
  not shipped as `node_modules`.
- Migration `066_oxequery_connections.sql` holds connection metadata.

## Connectivity

- **TLS**: `Off`, `Encrypted` (the certificate is NOT verified — the form says
  so), `Verify the chain` and `Verify the chain and host name`. A CA certificate
  and a client certificate and key can be attached; without a CA file the system
  trust store is used.
- **SSH tunnel**: connect through a bastion with a private key (optionally
  encrypted) or a password. The server's host key is shown as a SHA-256
  fingerprint the first time and pinned; a different key later is refused, never
  offered for one-click trust.
- **MongoDB**: auth source, replica set, several hosts, `mongodb+srv` seed lists
  and direct connection, all importable from a pasted connection string.
- Certificates and keys are chosen in a native dialog; the page only ever sees an
  opaque handle and the file name.

## Changing data, export and import

- **Editing rows (PostgreSQL).** Browse a table on a read-write connection and
  choose *Edit rows*. Updates, inserts and deletes are staged; *View SQL* shows
  the exact parameterised statements and *Apply* runs them in one transaction.
  The page sends structure (key, new values, old values), never SQL text. Every
  update/delete must match exactly one row *and* the values you last saw;
  otherwise the whole batch is rolled back with a conflict message. A table
  needs a primary key or a unique NOT NULL index to be editable.
- **Editing documents (MongoDB).** Edit, delete or add documents as EJSON. A
  replace or delete is refused when the stored document no longer equals the one
  you opened; `_id` cannot change.
- **Confirmation.** Deletes, and any write on a connection marked `prod`, ask
  for confirmation in the main process, not only in the page.
- **Export.** CSV, JSON, NDJSON or SQL `INSERT` from a table, a read query or a
  collection, streamed through a cursor (default cap 5 M rows, 20 M max). The
  destination comes from a native save dialog; an existing file is never
  overwritten and a cancelled export removes its partial file. CSV cells that
  start with `= + - @` are prefixed so spreadsheets do not run them as formulas.
- **Import.** CSV/TSV, JSON (array) or NDJSON up to 200 MB into a table or
  collection, with a column mapping, a **dry run** (the whole import inside a
  transaction that is rolled back) and 1 000-row batches. A table import is
  all-or-nothing; unreadable rows are skipped and written to
  `<file>.rejects.ndjson`. MongoDB uses `insertMany` with `ordered: false`, so
  documents that clash are reported and the rest are inserted.
## Agents (MCP)

AI agents running in a Thread reach OxeQuery through ten tools. **No database is available
until a person sets *Agent access* on a connection** (Connection → Limits and agents).
Listing containers and reading a container's recent log lines need no connection: the
list shows names, images, state and ports, and log lines are cut to 400 characters,
masked (connection-string passwords, bearer tokens, `password=`/`token=` values, private
keys) and marked untrusted. Starting, stopping or restarting a container always asks you.

| Access | What an agent may do |
|---|---|
| `off` (default) | Nothing; the connection is not even described. |
| `read` | Describe schemas freely. Read data only with your approval of the exact request. |
| `write` | Also change data, each statement approved. Never on a `prod` connection, never on a read-only connection. |

- **Approval.** A native dialog shows the connection, its environment and the exact
  statement; the default button is *Deny*. A grant is single use, expires in five
  minutes and is bound to the execution, the connection, the tool and the SHA-256 of
  the text: change one character and you are asked again. If you have not answered
  yet, the tool returns *approval pending*; the agent asks you and calls again with
  identical arguments. *Allow reads on this connection for this run* exists for reads
  only. A request longer than 6 000 characters is refused rather than shortened.
- **Reads** run in a `READ ONLY` transaction chosen by the server, one statement
  at a time per connection, with a 20 s limit; the driver's connection is never
  switched to read-write by an agent.
- **Output** is limited (50 rows by default, 200 max, 16 KB, 512 characters per cell),
  values of columns/keys that look sensitive (`password`, `token`, `secret`, `api_key`,
  `ssn`, `card`…) are replaced by `«masked»`, and every result says it is untrusted
  data and that instructions inside it must not be followed.
- **Limits.** 30 calls per minute per execution.
- **Audit.** The *Activity* tab lists every request: who, which connection, the
  statement with string literals removed, the decision and the outcome. The table is
  append-only and entries are kept 90 days.
- **Providers.** Claude with `bypassPermissions` and Codex with `approvalPolicy: never`
  do not ask for these tools; the dialog above is what protects you. Read-only Threads
  are not given the tools at all.
## Limits (by design, for now)

- Import does not infer or convert types for CSV into MongoDB (values stay text), and a
  MongoDB dry run only validates the file; it does not contact the server.
- A `mongodb+srv` seed list reached through an SSH tunnel falls back to the single
  host you entered.
- "Run command" splits on spaces and does not interpret quotes or pipes; use
  the Shell tab for that.
- Podman support follows the CLI's Docker compatibility and was not run on a
  machine with Podman installed.

## Verification

- `tests/unit/oxequery-parse.test.ts`, `oxequery-guards.test.ts`: parsers and guards.
- `tests/integration/oxequery-service.test.ts`: store, validation, routing.
- `tests/integration/terminal.service.test.ts`: the registered container shell.
- `e2e/oxequery.spec.ts`: the mode in the real renderer with an in-memory backend.
- `tests/live/oxequery-live.test.ts` (`OXE_LIVE=1`, needs Docker and a built
  worker): real containers, PostgreSQL 16 and MongoDB 7.
- `tests/live/oxequery-writes-live.test.ts` (`OXE_LIVE=1`): concurrent edits, hostile
  values, 100 000-row CSV/NDJSON round trips with a checksum, cancelled export, dry run,
  and MongoDB conflicts.
