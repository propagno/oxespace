# S7 · Agent mission control (design spec)

Status: draft for review · Owner: DESIGN/PRODUCT · Implements: S7.1 (BACKEND, read model), S7.2 (FRONTEND, screen),
S7.3 (FRONTEND, actions), S7.4 (MOBILE, phone) · Date: 2026-10-31

## 1. Outcome

**One place to see and act on every agent the person has running**: OxeCode panes, OxeChat conversations, delegations,
workers and their sub-agents, on the desktop and on the phone. In one glance the person knows who needs them, who is
working, who finished, and what it cost; in one action they answer, stop, resume or open any of them.

Exit check (plan.md S7): with 8 agents across modes, the central shows state, cost, session and requests live and lets
the person respond, stop, resume and open; the same picture on the phone.

### What it is not

- **Not a new mode.** Modes (OxeCode, OxeChat, OxeQuery, OxePod, OxePost) are products; agents cross them. The central is
  a surface over all modes, like the activity center.
- **Not the activity center.** The bell is a *feed* of things that happened (events, read/unread). The central is a
  *roster* of who exists now (entities, live state). They link to each other (§7).
- **Not a second approval UI.** Answering a request always goes through the B10/F18 in-app approval modal. The central
  never shows a one-click "Allow" (charter rule 4: one model per concept).
- **Not an agent tool.** The central is for the person. No new MCP tool, no extra tool text (T8); agents already have
  `oxespace_list_agents` / `delegation_status` for their own needs.

## 2. What already exists (reused, not rebuilt)

| Need | Already on main | Used for |
|---|---|---|
| Pane agent lifecycle | `shared/types/agent-state.ts` (`working/blocked/done/idle/unknown`, `seen`, `since`, `source`), `agent-state.service.ts` | pane rows, "finished, not seen" |
| Pane display language | `src/utils/paneDisplay.ts` (tones, `statusEstimated`, origin label, UX-07) | row status label and "estimated" style |
| Conversation status | `ThreadProviderObservation.state`, `RemoteThreadSummary.status/pendingRequests/backgroundRunning` | thread rows |
| Conversation cost | `ThreadCostReport` / `turn-cost` (`usd`, tokens) | cost column |
| Sub-agents | timeline `subagent` items (`receiverThreadIds`, `agents`) | nesting |
| Delegations | `DelegationState` (9 states), `DelegationSnapshot` | delegation rows |
| Workers | `WorkRunStatus`, `WorkTaskStatus` | worker rows |
| Requests | B10 `approvals.*` (risk computed by main, modal), `RemotePendingRequest` | "needs you" + Respond |
| Team roles | `TeamMember.connection.owner {kind: pane\|thread}` | role badge on rows |
| Feed | F30 activity store (`needs-you/finished/failed`, targets pane/thread/background) | cross-links |
| Mode attention | `ModeSwitch` attention counts | entry point (§6) |
| Primitives | `ToolPanel`, `Splitter`, `StatusDot`, `Badge`, `Menu`, `Tabs`, `SegmentedControl`, `EmptyState`, `ErrorState`, `OfflineState`, `Notice`, `Skeleton`, `ConfirmDialog`, `Tooltip`, `Kbd`, `toast`, `AgentProviderIcon` | everything on screen |
| Phone | `LiveHome.kt` tabs (Threads, Requests, Terminals, Tasks), `RequestScreen.kt` (biometrics), `OxeTokens.kt` | S7.4 |

Nothing in this spec needs new persistence. S7.1 is a **read model** aggregated by main from the sources above.

## 3. One vocabulary for agent state

Today each source speaks its own states (5 for panes, 7 for conversations, 9 for delegations, 7 for workers). The
central shows **seven**, in this priority order (also the sort order, §5.3):

| # | State | en | pt-BR | StatusDot | Means |
|---|---|---|---|---|---|
| 1 | `needs-you` | Needs you | Precisa de você | `attention` | stopped on an approval, question, review or permission |
| 2 | `failed` | Failed | Falhou | `danger` | last turn/run ended in error; nothing running |
| 3 | `working` | Working | Trabalhando | `running` | a turn, run or delegation is in progress |
| 4 | `finished` | Finished | Terminou | `success` | finished since the person last looked (unseen) |
| 5 | `idle` | Idle | Parado | `idle` | alive, waiting for a new prompt, already seen |
| 6 | `stopped` | Stopped | Interrompido | `idle` + stop glyph | interrupted or cancelled by someone |
| 7 | `unknown` | Not confirmed | Não confirmado | `idle`, dashed ring | no report; shown weaker, never as certain (UX-07) |

Mapping (for the S7.1 contract; BACKEND owns the final table and its contract test):

| Source | needs-you | failed | working | finished | idle | stopped | unknown |
|---|---|---|---|---|---|---|---|
| Pane (`AgentLifecycleState`) | `blocked` | terminal `error` | `working` | `done` & `!seen` | `idle`, or `done` & `seen` | process `exited` by stop | `unknown` |
| Conversation | `approval` or `pendingRequests > 0` | `failed` | `running` or `backgroundRunning > 0` | last turn `completed` & unread | `idle` | `interrupted` | `unknown` |
| Delegation | `blocked`, `review` | `failed` | `preparing`, `starting`, `accepted` | `approved` & unseen | `approved` & seen | `cancelled`, `interrupted` | — |
| Worker run | `blocked` | `failed` | `running` | `succeeded` & unseen | `succeeded` & seen | `cancelled` | — |

"Unseen" uses the existing `seen` (panes) and the F30 `lastSeenAt` (others); opening a row marks it seen.

## 4. Information architecture

```
Agents (central)
├─ Header: title · live summary ("2 need you · 4 working · US$ 3.10 today") · ⋯ menu (Project team…, Settings)
├─ Toolbar: filter [All | Needs you | Working | Finished] · group by [Project | State | Mode] · search
├─ Groups (default: by project/workspace, in sidebar order)
│   └─ Agent rows (sorted by state priority, then waiting time)
│       └─ Nested rows: delegations, workers, sub-agents under the agent that started them (max 2 levels shown)
├─ "Ended recently" (collapsed; rows that ended in the last 10 min, so nothing vanishes silently)
└─ Footer (full view only): "Showing 8 agents in 3 projects"
```

**Agent row = one thing with a lifecycle that can need the person**: a pane running an agent CLI, a conversation, a
delegation, a worker run. Plain shell panes are *not* agents and never appear. Background jobs are not agents either;
they appear only nested under the agent that started them, when it is known.

## 5. Desktop

### 5.1 Placement and size

- **Docked panel** on the right, built on `ToolPanel` + `Splitter`: default **400 px**, min **340 px**, max **560 px**
  (or 50 % of the window, whichever is smaller). Width persists per window (main-side settings, not localStorage).
- **Expand to full view** (button in the header, `Mod+Shift+Enter` while focus is in the panel): the panel becomes the
  whole content area, list switches to the table layout (§5.4). Esc or the same button returns to docked.
- Opening the central never changes the current mode; it sits next to whatever is open.
- Below 960 px window width the docked panel overlays the content (with scrim) instead of pushing it.

### 5.2 Row anatomy (docked)

```
┌──────────────────────────────────────────────────────────────┐
│ [◉]  Fix pairing timeout                         [Respond]  ⋯ │  line 1: title (1 line, ellipsis)
│ ⓒ    OxeChat · Claude · Frontend · 6 min · US$ 0.42           │  line 2: mode · provider · team role · time · cost
│      └ "Run npm test in mobile/?" · medium risk               │  line 3 (needs-you only): first request summary
└──────────────────────────────────────────────────────────────┘
```

- Leading: `AgentProviderIcon` (20 px) with the `StatusDot` (8 px) at its bottom right; the working dot pulses on `--duration-pulse`,
  none under reduced motion.
- Title: pane display title (`paneDisplay.title`), conversation title, delegation objective, worker task title.
  Never a path, never an id.
- Meta line: mode label (OxeCode/OxeChat/Delegation/Worker), provider, team role badge when the agent is a connected
  team member, time in state ("6 min" = since `since`; for needs-you it is the wait time), cost.
- Cost: provider-reported `usd` → "US$ 0.42"; tokens only → "18k tokens"; nothing → omitted (no "—" noise). Estimated
  values carry "≈" and a tooltip "Estimated from tokens". Header total sums only reported values and says so.
- Line 3 appears only for `needs-you`: the first pending request's main-built title and risk `Badge`
  (low=neutral, medium=warning, high/critical=danger); "+2 more" when several.
- Heights: comfortable **56 px** (2 lines) / **76 px** (3 lines); compact density **44 / 60 px**. Nested rows indent
  **16 px** per level with a 1 px `--border-subtle` guide.
- Targets: primary button `size="sm"` (≥ 24 px), overflow `IconButton` 24 px; the whole row is one focusable item.

### 5.3 Order and live updates

- Within a group: needs-you (longest wait first) → failed → working (longest running first) → finished → idle →
  stopped → unknown. Groups sort by their most urgent row, then sidebar order.
- **Rows never jump under the pointer or the focus.** While the pointer is over the list or focus is inside it, state
  changes update in place (dot, label, meta) but reordering is held; a pill "3 changes · Update order" appears at the
  top. Leaving the list or pressing the pill applies the order. Same rule as Linear's inbox/GitHub's "new items".
- A state change reaches the row in ≤ 1 s (S7.1 acceptance). The dot cross-fades on `--duration-fast` (120 ms);
  nothing else animates.
- **Nothing disappears without feedback.** An agent that ends (pane closed, conversation archived, delegation done and
  seen) shows "Ended" for 5 s in place, then moves to "Ended recently" (kept 10 min, max 20 rows).

### 5.4 Full view (table layout, ≥ 960 px content width)

Columns: Agent (icon, dot, title, nested) · Project · Mode · State (label + time in state) · Cost · Actions. Column
headers sort (click / Enter); default sort is the state priority. Max content width 1200 px, centered.

### 5.5 Actions (S7.3)

| Action | en / pt-BR | Available when | What it does | Feedback |
|---|---|---|---|---|
| Respond | Respond / Responder | needs-you | opens the **existing** approval modal (B10/F18) or the conversation at its question; never answers inline | modal opens < 100 ms; row returns to its new state when resolved |
| Open | Open / Abrir | always | goes to the pane (switches to OxeCode, focuses the pane) or the conversation (OxeChat), delegation detail, worker run; marks seen | panel stays open; target row stays selected |
| Stop | Stop / Parar | working | interrupts the current turn/run (`thread.interrupt`, pane agent stop, delegation/work cancel) | two-step inline: button turns into "Confirm stop" for 3 s; then "Stopping…" spinner; toast "Turn stopped" |
| Resume | Resume / Retomar | stopped/idle with a resumable session (pane: #40/B17 session; conversation: native session) | resumes the agent's session in place | "Resuming…"; on failure the row says why (F32 copy) |
| Mark as seen | Mark as seen / Marcar como visto | finished | moves it to idle without opening | instant; undo in toast (5 s) |

- Primary button per state: needs-you → **Respond**; working → **Stop** (secondary/ghost style, not danger red, so
  the list isn't a wall of red); everything else → **Open**. All actions are also in the `⋯` menu and the row's
  context menu.
- Unavailable actions are hidden in the button slot and **disabled with a reason** in the menu ("This agent has no
  saved session to resume").
- Bulk (v1.1, out of v1): multi-select + "Stop 3" with `ConfirmDialog`.
- Every action goes through existing IPC; any agent-reachable capability stays as `shared/mcp-coverage.ts` says
  (S7.3 acceptance: nothing user-only becomes agent-reachable).

### 5.6 Keyboard

| Key | Action |
|---|---|
| `Mod+Shift+O` (proposal; FRONTEND confirms against the keybinding catalog) | open / close the central, from anywhere (`reservedInTerminal`) |
| `↑` `↓` / `j` `k` | move between rows (roving tabindex) |
| `→` `←` | expand / collapse nested rows |
| `Enter` | Open |
| `r` | Respond (needs-you rows) |
| `Shift+S` | Stop (then `Enter` confirms inside the 3 s window) |
| `Shift+F10` / context-menu key | row menu |
| `/` | focus search |
| `Mod+Shift+Enter` | expand / restore full view |
| `Esc` | close (from the list), focus returns to the element that opened it |

Single-letter keys work only while focus is in the list, never in search or a terminal. Labels come from the
keybinding catalog so palette, menus and tooltips agree.

### 5.7 Surface states

| State | Shown as | Copy (en / pt-BR) |
|---|---|---|
| Loading (first open) | 3 `Skeleton` rows; summary hidden | — |
| Empty | `EmptyState`, actions "New agent in OxeCode", "New conversation" | "No agents running" / "Nenhum agente rodando" · "Agents you start in OxeCode or OxeChat show up here." / "Os agentes que você iniciar no OxeCode ou no OxeChat aparecem aqui." |
| Filter empty | inline text + "Show all" | "No agents need you" / "Nenhum agente precisa de você" |
| Search empty | inline text | "Nothing matches “{q}”" / "Nada corresponde a “{q}”" |
| Source partly unavailable | `Notice` (warning) above the list; other sources keep working | "Delegations can't be read right now. The rest is up to date." / "Não deu para ler as delegações agora. O resto está atualizado." |
| Read model failed | `ErrorState` + "Try again"; last list kept, dimmed, with "Updated {t} ago" | "Couldn't read the agents" / "Não deu para ler os agentes" |
| Action failed | inline error under the row (`FieldError` style) + toast with "Try again" | "Couldn't stop: {reason}" / "Não deu para parar: {motivo}" |
| Not confirmed state | dashed ring, label "Not confirmed", tooltip with origin (`originLabel`) | "No report from the agent yet" / "O agente ainda não informou" |

### 5.8 Accessibility

- The list is a `role="treegrid"` (nesting) in full view and a `role="tree"` docked; rows have names like
  "Fix pairing timeout, OxeChat, Claude, needs you for 6 minutes, 1 request". Dots are never the only signal: every
  state has a text label.
- One polite live region announces only transitions **into** needs-you and failed, batched (max one announcement per
  5 s: "2 agents need you"). Working/finished churn is not announced.
- Forced colors: dots get a system-color border, the dashed ring stays visible; reduced motion removes the pulse.
- Focus order: header → toolbar → first row; the panel traps nothing (it's docked, not modal). Overlay mode < 960 px
  behaves as a dialog (focus contained, Esc closes).

## 6. Entry points (and F35)

The F35 decision is a clean title bar (Team button out; activity bell stays). The central follows it — **no new
title-bar button in v1**:

1. Shortcut `Mod+Shift+O` and palette command "Show agents" / "Mostrar agentes" (+ "Agents needing you").
2. Menu View › Agents / Exibir › Agentes.
3. **Mode-switch attention badges** (already counting needs-you/failed/working per mode): clicking a badge opens the
   central filtered to that mode.
4. Activity center: an agent entry opens its target as today; the popover gets a footer link "See all agents".
5. Team: the central's `⋯` menu has "Project team…", which opens the existing Team dialog (one of F35's new homes).

If the S7 adoption metric (opens per active day, S5-style measurement) stays low after the RC, revisit a title-bar
icon. Recorded as an ASK to the coordinator (§11).

## 7. Relationship to other surfaces

- **Activity center**: event → entity. Each `needs-you`/`finished`/`failed` entry about an agent selects and highlights
  its row (`--fill-selected` flash on `--duration-slow`, none under reduced motion) when the central is open.
- **Sidebars** (OxeCode `PaneSessionRow`, OxeChat `ThreadSidebar`): stay the per-mode navigation; they use the *same*
  state labels and dot (§3), so a pane says "Needs you" in the sidebar, the pane header, the central and the phone.
  FRONTEND moves the labels to one i18n namespace (`agents.state.*`) used by all four.
- **Pane header / thread header**: unchanged; "Open" lands there.
- **Team**: role badge on rows of connected members; the Team dialog lists members, the central lists agents.

## 8. Phone (S7.4)

The phone already has Threads, Requests, Terminals and Tasks tabs. The central becomes the phone's **home**:

- Bottom navigation (Material 3 `NavigationBar`, 3 items): **Agents** · **Requests** (badge) · **More**
  (paired desktop, language, unpair). Threads/Terminals/Tasks become **filter chips** inside Agents (M3 `FilterChip`):
  All · Need you · Conversations · Terminals · Tasks.
- Row: M3 three-line list item, **72 dp** (two lines) / **88 dp** (with request line); leading provider icon 24 dp
  with dot; trailing primary action as a 48 dp touch target. Same state vocabulary and order as the desktop (§3, §5.3).
- Actions on the phone: **Respond** (the existing RequestScreen with biometrics; not-answerable requests show
  "Answer on the computer" / "Responda no computador", disabled with that reason), **Open** (ThreadScreen /
  TerminalScreen), **Stop** for conversations (`thread.interrupt`, already a remote command) with an M3 confirmation
  dialog. Stop for panes and **Resume** are not on the phone in v1 (no remote command; see §11).
- Offline: banner "Not connected to {desktop} · updated {t} ago" / "Sem conexão com {desktop} · atualizado há {t}",
  list dimmed, actions disabled with that reason; pull to refresh retries.
- Privacy: no paths, session ids or costs beyond the total on the phone (protocol rule: the phone omits cwd/session
  ids/cost per turn). Cost per row stays desktop-only in v1.
- Notifications (M6): a needs-you push opens the Agents tab with that row selected.

## 9. Copy (en / pt-BR)

| Key | en | pt-BR |
|---|---|---|
| title | Agents | Agentes |
| summary | {n} need you · {m} working | {n} precisam de você · {m} trabalhando |
| summary.cost | {usd} today | {usd} hoje |
| filter.all / needs / working / finished | All / Needs you / Working / Finished | Todos / Precisam de você / Trabalhando / Concluídos |
| group.project / state / mode | Project / State / Mode | Projeto / Estado / Modo |
| ended | Ended | Encerrado |
| endedRecently | Ended recently | Encerrados recentemente |
| reorder pill | {n} changes · Update order | {n} mudanças · Atualizar ordem |
| expand / restore | Expand / Restore | Expandir / Restaurar |
| action.respond / open / stop / confirmStop / resume / seen | Respond / Open / Stop / Confirm stop / Resume / Mark as seen | Responder / Abrir / Parar / Confirmar parada / Retomar / Marcar como visto |
| stopping / resuming | Stopping… / Resuming… | Parando… / Retomando… |
| toast.stopped | Turn stopped | Turno interrompido |
| resume.unavailable | This agent has no saved session to resume | Este agente não tem sessão salva para retomar |
| moreRequests | +{n} more | +{n} outros |
| cost.estimated | Estimated from tokens | Estimado pelos tokens |
| mode labels | OxeCode / OxeChat / Delegation / Worker | OxeCode / OxeChat / Delegação / Worker |

Voice: short, verb first, no internal ids, no English in pt-BR ("worker" is the product term in both, as in the
roadmap; HML flags it if the glossary decides otherwise).

## 10. References (market practice)

- **GitHub Agent HQ "mission control"** (2025): one place to assign, steer and track agents across GitHub, VS Code and
  mobile — same thesis, our version is local and multi-provider.
- **Warp agent management panel** (Warp 2.0, 2025): every agent across tabs with status and "needs attention"; the
  model for pane agents.
- **VS Code Agent Sessions view**: local, background and cloud sessions in one list — confirms "one list, many origins".
- **Linear Inbox**: keyboard triage (`j/k`, single-letter actions), rows that don't jump while you work.
- **Raycast Action Panel**: every item has its actions behind one key; basis for the row menu and IDEA 1.
- **Material 3** lists, filter chips and navigation bar; 48 dp targets — phone layout.

## 11. Decisions (coordinator, 2026-10-31)

1. **Entry point: decided, no title-bar button in v1.** Entry is `Mod+Shift+O`, the palette, View menu, mode-switch
   badges and the bell footer. Re-checked with the adoption metric after the RC.
2. **Phone: decided, conversations only in v1** (respond and `thread.interrupt`, both already remote commands).
   Stopping or resuming a pane from the phone moves to the 1.5 list. It needs its own threat review, because a phone
   stopping a terminal is a new remote action.
3. **Vocabulary: decided.** The 7 states in §3 and the single `agents.state.*` i18n namespace are the S7.1 contract.
   BACKEND owns the mapping test; the sidebar, pane/thread headers, the central and the phone all use these states.
4. **Shortcut** `Mod+Shift+O` (open): FRONTEND checks it against the keybinding catalog; the fallback is `Mod+Shift+G`.

## 12. IDEAs (not blockers)

- **IDEA 1 · Act from the palette**: `Mod+K` with a row focused lists its actions (Raycast). Cheap: the actions already
  exist as commands. Cost S.
- **IDEA 2 · "Since you left"**: when the window regains focus after > 15 min, the summary says "While you were away: 3
  finished, 1 needs you" (Linear/Slack catch-up). Uses F30 `lastSeenAt`. Cost S.
- **IDEA 3 · Budget glance**: header cost turns warning when today's reported cost passes a person-set limit. Cost M
  (needs a setting).

## 13. Acceptance hooks (for HOMOLOGATION)

Test ids: `agents-panel`, `agents-summary`, `agents-filter`, `agent-row` with `data-agent-kind`
(`pane|thread|delegation|worker`) and `data-agent-state` (§3 values), `agent-action-respond|open|stop|resume|seen`,
`agents-reorder-pill`, `agents-ended-recently`. Phone: `agents_tab`, `agent_row`, same state names.
Scenarios beyond S7.2/S7.3/S7.4 rows: rows don't reorder under the pointer; an ended agent never vanishes without the
"Ended" step; Respond always opens the B10 modal (no inline allow); pt-BR has no English except product names;
light/dark; forced colors; 960×640 and 4K.
