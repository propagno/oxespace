# OxeQuery

OxeQuery is the third application mode (next to OxeCode and OxeChat). It shows the
containers that run on this machine (Docker or Podman) and connects to
PostgreSQL and MongoDB, so a database and the container it runs in are one
click apart.

It is an original implementation. Beekeeper Studio was only a reference for what
such a tool should offer, compared by behavior; no code from it is used (its
Community Edition is GPLv3 and its MongoDB support is commercial, while OXESpace
is MIT).

## What it does

### Connections

- **List.** Favorites first, the three used most recently, then groups (folders),
  then the rest. A search box appears once the list is long and looks at name,
  group, host, database and engine. A connection can have a color (it marks its
  tab) and shows a PROD badge on its tab when it is production.
- **Create.** Fill the form or paste a `postgres://` / `mongodb://` string
  ("Connect by Host | URL"). Mark the environment (local, development,
  production) and keep it read-only (the default) or not. *Test connection*
  before saving.
- **Connect without saving.** Uses the same form but writes nothing: the
  connection, its password and its tabs live in memory for this session and are
  gone when the app closes. It keeps no history or saved queries (those belong to
  saved connections) and agents never see it.
- **Duplicate, favorite, move to a group** from the sidebar. **Export** writes a
  JSON file *without passwords, keys or certificates*; **import** reads it back
  (agents are switched off, and a tunnel that needs a key or password is skipped
  because the file cannot carry the secret).
- **TLS, SSH, MongoDB options.** TLS `Off`, `Encrypted` (certificate not verified;
  the form says so), `Verify the chain` and `Verify the chain and host name`, with
  an optional CA and client certificate. SSH tunnels through a bastion with a
  private key, a password or **the SSH agent** (`SSH_AUTH_SOCK`, or the OpenSSH
  agent's pipe on Windows; nothing is stored). The host key is shown as a SHA-256
  fingerprint the first time and pinned; a different key later is refused. Keep-alive
  probes keep quiet connections open. MongoDB: auth source, replica set, several
  hosts, `mongodb+srv`.
- **When a connection drops** the error shows a *Reconnect* bar; the next statement
  also dials again by itself.
- **Settings** (gear in the sidebar): how many statements the history keeps, how long
  the agent audit log is kept, and the most an agent may be given on a local,
  development or production connection.

### PostgreSQL

- **SQL editor** (Monaco): `Ctrl+Enter` runs the selection, or the statement the
  cursor is in; `Ctrl+Shift+Enter` runs all of them, one result tab per statement
  (a script stops at its first error and puts a marker where it failed). Completion
  from the schema, snippets, formatter, line comments, find and replace.
- **Parameters.** `:name` and `$1` ask for a value before running and are sent as
  real parameters. **Transactions:** auto-commit by default; *Begin transaction*
  keeps one open on the tab's connection and says so until it is committed or rolled
  back.
- **Tabs** (SQL and cursor position) are saved per connection and come back.
- **Results.** A grid that draws only the rows in view (100 000 rows is fine):
  keyboard navigation, block selection, resize and hide columns, sort on the server
  when browsing a table, NULL shown apart from the text "NULL", a row panel, a cell
  viewer (JSON, long text), *Copy as* CSV, TSV, JSON, Markdown or INSERT. Results
  are cut at 100 000 rows or 32 MB and say which limit applied.
- **Table browse** with a filter bar (operators per column, bound parameters) and
  paging; **edit rows**: updates, inserts and deletes are staged, *View SQL* shows
  the exact parameterised statements, *Apply* runs them in one transaction, and a
  row that changed under you rolls everything back.
- **Schema tree.** Virtualized, with Tables, Views, Materialized views, Foreign
  tables, Functions, Sequences, Types and Triggers per schema, Extensions, pinned
  tables, and one search across every schema. Arrow keys move, open and close.
  Functions, types, triggers and sequences open as their definition in a new tab; a
  materialized view can be refreshed from its row.
- **Structure editor.** *New table* and *Structure* open a dialog to create a table
  or change its columns (type, NOT NULL, default, identity), keys (primary, unique,
  check, foreign with ON DELETE / ON UPDATE) and indexes (method, unique, partial).
  *Review SQL* shows the exact DDL and what is risky (data loss, locks, a rewrite);
  *Apply* runs it in one transaction. Dropping or truncating a table, a column drop,
  and any change on a production connection need an explicit tick. The page sends
  structure, never SQL text: the main process builds the statements, quotes every
  name, checks types against a pattern and accepts only a single expression for a
  default or a check. Also: rename, comment, duplicate (with or without rows),
  truncate, drop, VACUUM / ANALYZE / REINDEX, who depends on the table and who may
  use it.
- **Server.** The databases (create with owner and encoding; drop with a typed
  confirmation, never the one you are connected to) and the roles (read-only).
- **EXPLAIN / ANALYZE** with a plan view and hints; ANALYZE of a write asks first.
- **Cancel** stops the running statement from a second session.

### MongoDB

- **Find** with filter, projection, sort, limit and skip, each checked as JSON before
  it is sent; **aggregate** with paging; results as documents, a tree (typed values
  keep their type) or a table. **Explain** reads the planner's answer in words and
  warns about a collection scan or an in-memory sort. **Cancel** stops the operation
  on the server.
- **Edit** a document as extended JSON (Int64, Double and Decimal128 are not retyped),
  **clone**, **delete**, **insert**. The write only matches a document that still
  equals the one you opened.
- **Change many.** `updateMany` (update operators only) and `deleteMany` count first;
  the change runs only for the number you confirmed, so a collection that moved asks
  again. An empty filter is called out.
- **Collections:** create (optionally capped), rename, drop (typed confirmation).
  **Statistics**, **validation rules** (`$jsonSchema`, level and action), indexes and an
  inferred schema.
- **Library and history** for MongoDB queries, like SQL.

### Data

- **Export** CSV, JSON, NDJSON, SQL INSERT or **Excel (.xlsx)** from a table, a read
  query or a collection, streamed (default cap 5 M rows; a sheet holds 1 048 576).
  The destination comes from a native save dialog; an existing file is never
  overwritten and a cancelled export removes its partial file. Cells that start with
  `= + - @` are written as text.
- **Import** CSV/TSV, JSON or NDJSON up to 200 MB into a table or collection, with
  the delimiter, encoding (UTF-8, UTF-16, Windows-1252) and header row checked or
  chosen, a column mapping, a **dry run** and 1 000-row batches. If a row's key
  already exists, stop (nothing kept), **skip** it or **update** it. Unreadable rows
  go to `<file>.rejects.ndjson`.

### Containers

- Every container the engine knows (running first), with state, ports, stats, details,
  live logs, run a command, an interactive shell, start/stop/restart. Images, volumes,
  networks and disk usage, and *New database* (a PostgreSQL or MongoDB container with a
  generated password kept in secure storage).
- **Compose projects.** Choose a project in the list to Up, Start, Stop, Restart, read
  Logs or take it Down (confirmed; volumes are kept). The folder and files come from the
  labels on the project's own containers, never from the page.
- **Engine.** Docker or Podman, and which Docker daemon or context when a machine has
  several. Podman short image names are qualified with `docker.io/library/`.

### Agents

- **Ask agent** (in the SQL and MongoDB toolbars) pastes a prompt into the workspace's
  agent terminal to explain a statement, fix an error, read a plan or write a query. It
  carries the statement, the error or plan and table and column names, never rows; you
  read it and press Enter.
- What an agent can do through OxeQuery is in [Security model](SECURITY_MODEL.md) and
  below.

## Safety model

| Concern | Rule |
|---|---|
| Passwords | Stored through Electron `safeStorage` in `secure_credentials` (`oxequery:<id>`). If the OS cannot encrypt (on Linux, `basic_text` is refused unless `OXESPACE_ALLOW_WEAK_SECRETS=1`), saving a password is refused. Never returned to the renderer, never logged; history and audit redact literals. |
| Writes | Connections are **read-only by default**. Read-only runs every statement in `BEGIN READ ONLY … ROLLBACK`, so the server refuses writes even when a statement hides one. |
| Destructive SQL and structure | `DROP`, `TRUNCATE`, `DELETE`/`UPDATE` without `WHERE`, `ALTER … DROP` ask for confirmation, in the main process. A `prod` environment is labelled and asks even for a harmless structure change. |
| Production | A statement that changes data or the schema (writes, DDL, a script that holds one, `EXPLAIN ANALYZE` of a write) on a `prod` connection needs the connection's name typed, checked in the main process. A read never does. Production reads at most 1,000 rows and gives a statement 30 seconds; Settings sets these ceilings for each environment, and a connection's own values can only be lower. An organization policy rule `db.write` (see POLICY.md) makes a connection read-only whatever its setting says. Agents keep their own rule: never a write to production. Table edits, structure changes and MongoDB writes keep their existing production confirmation. |
| Lint | The editor marks `UPDATE`/`DELETE` without `WHERE`, `DROP`/`TRUNCATE`/`ALTER … DROP`, `SELECT *` on a table the catalog estimates at 100,000 rows or more, and (production only) a `SELECT` without `LIMIT`. The destructive ones ask for confirmation before they are sent. The lint is advice: the main process's guard is the rule. |
| MongoDB input | EJSON only (no `eval`). `$where`, `$function`, `$accumulator` are refused; `$out`/`$merge` are refused; an update is operators only. |
| Containers | The CLI is called with an argv array and a fixed set of subcommands. Container ids match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`. Compose runs in the folder the engine recorded. |
| Shell | The renderer receives an opaque pane id. The command is registered by the main process and cannot be supplied by the renderer. |
| Network | The renderer never opens sockets (CSP `connect-src 'self'`). Database traffic runs in a worker thread (`out/main/oxequery-worker.js`). |
| Files | The renderer never supplies a path; main opens the native dialog. |

## Architecture

```
Renderer (lazy chunk)        Main                              Worker thread
OxeQueryView  ── oxeQuery:call ──►  OxeQueryService  ──►  OxeQueryCore
ContainersPanel                      ContainerRuntime         pg + pg-cursor
SqlWorkbench / MongoWorkbench        ConnectionStore          mongodb + bson
SchemaTree / StructureEditor         PreferenceStore
             ◄── oxeQuery:event ──   (SQLite + safeStorage)
```

- One IPC command channel (`oxeQuery:call`) returns `{ ok, value | error }`, so the error
  code survives the process boundary; the allowed operations are listed once and checked
  against the type map by a unit test. One event channel streams logs and changes.
- Dialogs (structure, server, bulk change, collections, settings) load on first use.
- Migrations: `066` connections, `067` connectivity, `069` library, `070` audit, `074`
  workspace, `075` organization (groups, favorites, colors, masked names, keep-alive, SSH
  agent), `076` preferences. The connection table is never rebuilt after `067` because
  its children cascade on delete.

## Agents (MCP)

AI agents running in an OxeChat conversation reach OxeQuery through ten tools. **No database and no
container is available until a person sets *Agent access* on a connection** (Connection →
Limits and agents); a container is visible to agents only when a connection to it has
agent access on.

| Access | What an agent may do |
|---|---|
| `off` (default) | Nothing; the connection is not even described. |
| `read` | Describe schemas freely. Read data only with your approval of the exact request. |
| `write` | Also change data, each statement approved. Never on a `prod` connection, never on a read-only connection. |

OxeQuery's settings cap this by kind of environment (by default production is read at
most). A connection's own setting can only be lower than the cap.

- **Approval.** A native dialog shows the connection, its environment and the exact
  statement; the default button is *Deny*. A grant is single use, expires in five
  minutes and is bound to the execution, the connection, the tool and the SHA-256 of
  the text. *Allow reads on this connection for this run* exists for reads only. A
  request longer than 6 000 characters is refused rather than shortened.
- **Reads** run in a `READ ONLY` transaction chosen by the server, one statement at a
  time per connection, with a 20 s limit.
- **Output** is limited (50 rows by default, 200 max, 16 KB, 512 characters per cell).
  Values of columns and keys that look sensitive, and any name added in the connection's
  *Names agents must not see*, are replaced by `«masked»`. Every result says it is
  untrusted data.
- **Limits.** 30 calls per minute per execution.
- **Audit.** The *Activity* tab lists every request: who, which connection, the statement
  with string literals removed, the decision and the outcome. Entries are kept as long as
  the settings say (90 days by default).
- **Providers.** Claude with `bypassPermissions` and Codex with `approvalPolicy: never`
  do not ask for these tools; the dialog above is what protects you. Read-only conversations are
  not given the tools at all.

## Limits (by design, for now)

- Not included: ER diagrams, schema diff, backup and restore, visual aggregation and
  filter builders, other engines (MySQL, SQLite, Redis), GridFS.
- CSV import into MongoDB keeps values as text. A MongoDB dry run only validates the
  file; it does not contact the server.
- A `mongodb+srv` seed list reached through an SSH tunnel falls back to the single host
  you entered.
- "Run command" splits on spaces and does not interpret quotes or pipes; use the Shell
  tab for that.
- Compose needs the engine's compose plugin and the project folder on this computer.
- Cancelling a MongoDB operation stops it on the server only with the `killOp` privilege. Without it OXESpace
  still abandons the operation and closes its cursor, and the server stops it at the statement time limit.

## Verification

- Unit: `tests/unit/oxequery-*.test.ts` (parsers, guards, DDL builder, structure and tree
  models, XLSX writer, compose, prompts, op contract).
- Integration: `tests/integration/oxequery-*.test.ts` (store, organization, preferences,
  library, workspace, service, agent gateway).
- Components: `tests/oxequery-*.test.tsx` (SQL and MongoDB workbenches, structure and
  table editors, connection dialog, result grid, performance guards).
- End to end: `e2e/oxequery*.spec.ts` in the real renderer with an in-memory backend,
  including a contrast audit in light and dark and typing under CPU throttle.
- Live (`OXE_LIVE=1`, a built worker and **Docker or Podman**, `OXE_CONTAINER_ENGINE`
  chooses): `tests/live/oxequery-live.test.ts`, `oxequery-connectivity-live.test.ts`
  (TLS, SSH tunnel, host keys) and `oxequery-writes-live.test.ts` (structure, bulk
  changes, import/export, plans, cancel) against PostgreSQL 16 and MongoDB 7. CI runs the
  suite on both engines.
