# CCR A10 (U12-be): one Agent activity read model (1.5.0, phase F2)

- **Owner:** BACKEND (design).
- **Built by:** the OXE executor, from the F2 PLAN.json.
- **Frozen test:** `tests/acceptance/f2/a10-agent-activity-read-model.test.ts`. It is red today because the module does not exist.
- **Reviews (M5):** DESIGN, HML and FE review the frozen test before it enters the plan.
- **Depends on:** A12 (T64) PR 1 for the `oxepost_audit` table. A10 runs after it in the plan.

## Why

Settings › Agent activity (U12) shows one list with sources: Changes, Databases, Containers, and OxePost once T64 lands. Today:
- each source is a different read: `mcpInternal.actionAudit(limit)` reads `agent_action_audit`; OxeQuery's audit list reads `oxequery_audit`;
- each read returns the newest N only;
- nothing filters on the server.

The plan says the renderer never merges two lists. This CCR is the one query that does it in main.

## Sources (no new table for the first three)

| `source` | Table | Rows |
|---|---|---|
| `changes` | `agent_action_audit` (078) | every row (MCP actions on the app: tasks, git, terminals, settings…) |
| `databases` | `oxequery_audit` (070) | rows whose `tool` is not a container tool |
| `containers` | `oxequery_audit` | rows whose `tool` starts with `oxespace_container` (container actions and logs are audited there today) |
| `post` | `oxepost_audit` (A12) | every row |

## Row shape (`shared/types/agent-activity.ts`)

```ts
export const AGENT_ACTIVITY_SOURCES = ['changes', 'databases', 'containers', 'post'] as const
export type AgentActivitySource = typeof AGENT_ACTIVITY_SOURCES[number]
export interface AgentActivityRow {
  /** `<source>:<row id>`, stable: the detail reference and the React key. */
  id: string
  source: AgentActivitySource
  /** ms since epoch, the audit row's ts. */
  at: number
  /** Parsed from the audit `actor` label: `thread:<id>`, `pane:<id>`, anything else is `agent` with no id. */
  actor: { kind: 'thread' | 'pane' | 'agent'; id: string | null; label: string }
  tool: string
  /** One line, already redacted where it was written; cut to 200 characters here. */
  summary: string
  /** What it acted on: connection name, container, collection · environment, workspace id; null when none. */
  target: string | null
  /** true for a change: a write level, a write tool, or a non-GET/HEAD/OPTIONS request. */
  write: boolean
  decision: 'auto' | 'approved' | 'approved-session' | 'denied' | 'refused' | 'pending'
  outcome: 'ok' | 'error' | 'skipped'
  durationMs: number | null
  errorCode: string | null
}
export interface AgentActivityPage { rows: AgentActivityRow[]; nextCursor: string | null }
```

- **`summary`:**
  - changes: `<action> · <text>`;
  - databases: the statement text;
  - containers: the action text;
  - post: `<METHOD> <path>`.

  All are taken from columns that were redacted when written. Main never re-reads anything else.
- **`write`:**
  - changes: `level` is `write` or `confirm`;
  - databases: `tool` is `oxespace_db_execute` or `oxespace_mongo_write`;
  - containers: `tool` is `oxespace_container_action`;
  - post: `method` is not GET, HEAD or OPTIONS.

## Query, page and cursor

```ts
export interface AgentActivityQuery {
  sources?: AgentActivitySource[]          // default: all four; an empty list is refused
  view?: 'all' | 'writes' | 'problems'     // problems = outcome 'error' or decision 'denied' | 'refused'
  actor?: { kind: 'thread' | 'pane'; id: string }
  since?: number; until?: number           // ms, inclusive since / exclusive until
  limit?: number                           // default 50, clamped to 1..200
  cursor?: string                          // from the previous page's nextCursor
}
```

- **Order:** newest first, a total order: `at DESC`, then the source in the order above, then the row id DESC. Two rows with the same `at` always come out in the same order.
- **One SQL query:** a `UNION ALL` over the selected sources, with each source's filter pushed into its own `SELECT`.
  - `ORDER BY ts DESC, src ASC, id DESC LIMIT limit + 1`; the extra row only tells whether there is a next page.
  - Keyset pagination: `WHERE (ts < ?) OR (ts = ? AND (src > ? OR (src = ? AND id < ?)))`. No OFFSET.
- **Cursor:** base64url of `v1:<at>:<source index>:<id>`. An unknown, malformed or foreign cursor is refused (`invalid`), never treated as "start".
- **Stability:** a page read while new rows arrive never repeats or skips a row. Rows are append-only (each table has a no-update trigger), and new rows only ever land before the first cursor.
- **Retention:** the same 90 days as today's audits. `since` older than that just returns nothing.

## Detail

`detail(id)` returns the full audit row of its own table, with its columns in camelCase plus `source`: the T63 modal's fields, already redacted where they were written.
- changes: `workspaceId, tool, action, level, text, textHash, decision, outcome, durationMs, errorCode`;
- databases and containers: `connectionName, engine, environment, tool, text, textHash, rowCount, …`;
- post: `collection, requestName, environment, method, urlPath, status, …`, plus the masked response excerpt, up to 4 KB (A12).

An unknown or malformed id gives `null`.

`oxepost_audit` columns this model reads (fixed by A12): `id, ts, actor, workspace_id, collection, request_name, environment, method, url_path, status, decision, outcome, duration_ms, error_code, response_excerpt`. The post `target` is `<collection> · <environment>`.

## Surface

| Channel | Input | Output | MCP |
|---|---|---|---|
| `agent-activity:list` (`IPC_CHANNELS.agentActivity.list`) | `AgentActivityQuery` | `AgentActivityPage` | **excluded**: the person's record of what agents did; no agent reads it. |
| `agent-activity:detail` (`IPC_CHANNELS.agentActivity.detail`) | `id: string` | the row's detail or `null` | **excluded** |

- **Input checks:** sources must come from the list; `view` from its three values; the actor kind must be `thread` or `pane`, with an id of at most 200 characters; `since`/`until` finite; the limit is clamped; the cursor is at most 200 characters.
- **Old channels stay** (`mcpInternal.actionAudit`, OxeQuery's audit list) until U12's page uses the new one. Then FE removes their callers, and they can go in 1.5.x.
- **Service:** `electron/main/services/agent-activity/read-model.ts`, `class AgentActivity { constructor(db, now?); list(query): AgentActivityPage; detail(id): AgentActivityDetail | null }`, plus `parseAgentActivityQuery(raw)` for the IPC input. It reads only. No migration.

## Caps

| What | Cap |
|---|---|
| page size | 1..200, default 50 |
| summary | 200 characters, cut |
| cursor | 200 characters |
| actor id | 200 characters |

A page is one SQL statement, with each `SELECT` using its table's `ts` index (070, 078, and A12's `oxepost_audit` index).

## Frozen test (`tests/acceptance/f2/a10-agent-activity-read-model.test.ts`, `npm run test:electron`)

It writes rows straight into the four tables of an in-memory database (migrations applied) and checks:
1. **Merging:** one list across sources, in the total order, with the source and the parsed actor right.
2. **Pages:** walking every page with `limit: 3` gives every row exactly once, in order, with no repeat or gap, also with rows sharing one `ts`. The last page has `nextCursor: null`.
3. **Stability:** new rows written while paging never show up in later pages and never shift them.
4. **Filters:**
   - `sources`;
   - `view: 'writes'`, per source rule;
   - `view: 'problems'`;
   - `actor` (thread and pane);
   - `since`/`until`.
5. **Refusals and clamps:** an empty `sources`, an unknown source or view, and a bad cursor are refused. The limit clamps to 1..200 and the summary is cut to 200.
6. **Detail:** by id, and `null` for an unknown id.
7. **Surface:**
   - `IPC_CHANNELS.agentActivity.list` / `.detail` exist with those names;
   - exactly one mcp-coverage capability claims each, and it is `excluded`.

## Out of scope

- The U12 page itself (FE, A11).
- Exporting through the new model (the old export stays).
- Live push: the page re-queries on focus or on an `agent-activity:changed` ping, which can come later.
