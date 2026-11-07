# CCR A11: Settings › Agent activity, one list from every source (1.5.0 F2: U12, T63)

Owner: FRONTEND. Status: design for review (M5: DESIGN, HML, then TECH LEAD puts it in the F2 PLAN.json). No product
code in this PR. Frozen test: `tests/acceptance/f2/a11-agent-activity-page.test.tsx`, red today (section 6).
Acceptance: SPEC A11, "Settings › Agent activity lists every source with the same columns, filters and detail modal
(T63)", verified by `e2e/agent-activity*.spec.ts`. It reads BACKEND's A10 read model: CCR #650,
`docs/roadmap-1.5/ccr-a10-agent-activity-read-model.md` (row, page, query, cursor and the two channels). Design:
playground `#settings-activity` (approved 04/11).

## 1. What main does today

Read on main at 60e310d9. `AgentActivitySettings.tsx` calls `window.oxe.mcpInternal.actionAudit(100)`: only the
OXESpace MCP actions, the last 100, as a dotted list with no filter and no detail. OxeQuery's audit has its own list in
OxeQuery. Containers and OxePost requests are not shown anywhere in Settings.

## 2. The rule

**The renderer never merges lists.** The page makes one `agentActivity.list(query)` call per page, and shows the rows
in the order they come (A10 orders them: `at` DESC, then source, then id DESC). It never calls `actionAudit` or the
OxeQuery audit list, and never sorts or concatenates rows from two calls, except appending the next page of the same
query.

## 3. Columns (the same for every source)

| # | Column (en) | From the row | Notes |
|---|---|---|---|
| 1 | When | `at` | Time today; date and time before today. A `<time dateTime>` with the full date as the title. |
| 2 | Agent | `actor.name`, else a fallback | A10 resolves `actor.name` in main (the conversation's title, or the pane's display or agent name), so desktop and phone show the same words. When it is `null`: thread → "Closed conversation", pane → "Closed terminal", agent → the provider from `actor.label`, person → **You**. Never the raw `thread:<id>` / `pane:<id>` label. |
| 3 | Source | `source` | Changes, Databases, Containers, Requests (`post`), with the source's 3 px color mark, never color alone. |
| 4 | What | `summary`, or the access line | One line, ellipsis; mono for databases and requests. A row with `accessChange: { from, to }` (A12: a person changed an agent's access to an OxePost collection; its `summary` is empty) is localized here, never stored in English: "Access: Off → Read" / "Acesso: Desligado → Leitura", with the levels Off, Read, Write (pt-BR Desligado, Leitura, Escrita). |
| 5 | Target | `target` | Empty when `null`. |
| 6 | Result | `decision` + `outcome` + `errorCode` | Section 4. |

The table is a real `<table>` with `<th scope="col">` headers and one `<td>` per column, in this order. A row keeps its
`row` role (no `role="button"` on the `<tr>`). It is focusable (`tabIndex={0}`), and Enter or a click opens the detail.
The What cell holds a real `<button>` with the summary as its text, so screen readers and keyboard users reach the
detail without guessing.

## 4. Result words

Checked in this order:

| Condition | Result (en) | Tone |
|---|---|---|
| `decision` `pending` | Waiting for you | attn |
| `decision` `denied` | Denied | warning |
| `decision` `refused` | Refused by the policy | warning |
| `outcome` `error` | Failed (`errorCode` after it when set: "Failed · E_TIMEOUT") | danger |
| `outcome` `skipped` | Skipped | neutral |
| `decision` `approved` / `approved-session` | Approved | success |
| `decision` `auto` | Done | success |

## 5. Filters, pages and detail

- **Source:** All, Changes, Databases, Containers, Requests: one toggle group (`aria-pressed`). All sends no
  `sources`; one source sends `sources: [source]`. Counts are not shown, since A10 doesn't count.
- **View:** All, Writes, Problems: a segmented control, sending `view: 'all' | 'writes' | 'problems'`.
- **Changing a filter** starts again from the first page (no `cursor`).
- **Load more:** shown when `nextCursor` is not null. It sends the same query with `cursor: nextCursor` and appends the
  rows. Default `limit` (50).
- **Detail:** opening a row calls `agentActivity.detail(id)` and shows a `Dialog` (`size="md"`). Its title is the
  What, then: When, Agent, Source, Target, Tool, Decision, Outcome, Duration, Error code, and the source's own fields
  from the detail (for post, the masked response excerpt in a `<pre>`). A `null` detail shows "This entry is no longer
  kept" in the dialog.
- **States (U9):** `LoadingState` in the table's place while the first page loads. Empty: an `EmptyState`, "Agents
  haven't done anything here yet", or with a filter, "Nothing matches these filters". Error: `ErrorState` with Try
  again.
- **Kept:** Refresh (re-runs the current query from the first page) and Export (the old `exportAudit`, unchanged;
  A10 leaves export out of scope).

## 6. Frozen test (red today, for these reasons)

`tests/acceptance/f2/a11-agent-activity-page.test.tsx` renders `AgentActivitySettings` with a fake
`window.oxe.agentActivity` `{ list, detail }` holding one row from each source:

1. One `list` call on open, with no `sources` and `view: 'all'`. `mcpInternal.actionAudit` is never called (the fake
   has none). **Red today:** the page calls `actionAudit`.
2. A table with the six column headers of section 3, and four rows in the order `list` returned them.
3. The result words of section 4 for the fake rows (Done, Denied, Failed · E_TIMEOUT, Waiting for you).
4. The Databases toggle sends `sources: ['databases']`; Problems sends `view: 'problems'`; each starts with no cursor.
5. Load more sends `cursor` = the page's `nextCursor` and appends rows; it is gone when `nextCursor` is null.
6. Opening a row calls `detail(id)` and shows a dialog named by the row's What.
7. The source never calls a second list API: no `actionAudit`, no OxeQuery audit list.
8. The Agent column shows `actor.name` when set; with `name` null it shows "You" for a person and "Closed conversation" for a thread, never the raw label.
9. A row with `accessChange: { from: 'off', to: 'read' }` and an empty `summary` shows "Access: Off → Read" in What.

## 7. Questions for review

- **DESIGN:** the playground shows five columns (When, avatar, Task, What, Result). This CCR adds Source and Target as
  columns, because A10 gives them for every source and color alone can't carry the source. Keep six, or fold Target
  into What's second line?
- **HML:** the e2e `agent-activity*.spec` runs on CI with seeded audit rows of the four sources.
- **BACKEND (answered 07/11):** the preload is `window.oxe.agentActivity.list(query)` / `.detail(id)` (#650 at
  b8921c1d), `actor.kind` can be `person`, and `actor.name` carries the resolved name, and a person's access change comes as `accessChange: { from, to }` with an empty summary (#650 at 16ea1b9d; section 3).
