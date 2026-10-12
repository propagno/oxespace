# OxeQuery

OxeQuery is the third application mode (next to Code and Thread). It shows the
containers that run on this machine (Docker or Podman) and connects to
PostgreSQL and MongoDB, so a database and the container it runs in are one
click apart.

It is an original implementation. Beekeeper Studio was only a reference for what
such a tool should offer; no code from it is used (its Community Edition is
GPLv3 and its MongoDB support is commercial, while OXESpace is MIT).

## What it does

- **Containers**: list with state and published ports, filter, start / stop /
  restart, details (image, command, ports, networks, mounts, environment
  *names only*), live logs, run a command once, and an interactive shell.
- **PostgreSQL**: saved connections, schema tree, table browse with paging,
  SQL editor (Monaco), cancel, row limit, copy as CSV / JSON.
- **MongoDB**: database and collection tree, `find` (filter, projection, sort,
  paging), `aggregate`, indexes, documents as EJSON.
- **From a container**: the database button on a Postgres or MongoDB container
  creates the connection (host, published port, user, database and password
  from the container's environment). The password goes straight to secure
  storage and is never shown.

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

## Limits (by design, for now)

- No SSH tunnels, no row or document editing from the grid, no import.
- TLS "require" does not verify the certificate.
- "Run command" splits on spaces and does not interpret quotes or pipes; use
  the Shell tab for that.
- The Mongo `authSource` is `admin`.
- Podman support follows the CLI's Docker compatibility and was not run on a
  machine with Podman installed.

## Verification

- `tests/unit/oxequery-parse.test.ts`, `oxequery-guards.test.ts`: parsers and guards.
- `tests/integration/oxequery-service.test.ts`: store, validation, routing.
- `tests/integration/terminal.service.test.ts`: the registered container shell.
- `e2e/oxequery.spec.ts`: the mode in the real renderer with an in-memory backend.
- `tests/live/oxequery-live.test.ts` (`OXE_LIVE=1`, needs Docker and a built
  worker): real containers, PostgreSQL 16 and MongoDB 7.
