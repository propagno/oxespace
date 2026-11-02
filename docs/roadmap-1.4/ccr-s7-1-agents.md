# CCR · S7.1 agents read model (desktop + phone C5)

Status: proposal, BACKEND, for 1.4.1. **One CCR**, as the coordinator asked (31/10): everything the teams sent for
S7.1 is folded in here, so nothing needs a second one. Spec: [docs/design/s7-mission-control.md](../design/s7-mission-control.md)
(§3 mapping, §3.4 seen, §8 and §11.5 phone, §14 files). Red acceptance: #441 (`e2e/acceptance/S7.1-agents-overview.spec.ts`).

Reviewers: TECH LEAD (scope, order), FRONTEND (window, `agents.state.*`), MOBILE (C5 block, #347), DESIGN (states,
risk words), SECURITY (the C5 block and `agent.markSeen`).

## 1. What changes, in one line each

| Area | Change | Owner |
|---|---|---|
| Vocabulary | 7 states and 4 kinds, in `shared/types/agents.ts` | BACKEND |
| Mapping | one pure function `shared/agents/agentState.ts`, one contract test | BACKEND |
| Read model | main aggregates panes, conversations, delegations and work runs | BACKEND |
| Seen store | `agent_seen` table (migration), main-side `seenAt` per agent | BACKEND |
| Desktop channels | `shared/types/ipc/agents.ts`, preload module `electron/preload/agents.ts`, e2e double `electron/main/e2e/agents-mock.ts` | BACKEND |
| Phone | `agents` subscription, `agent.markSeen` command, in `shared/remote/protocol.ts` (+ `android:generate`) | BACKEND, MOBILE |
| MCP | every `agents:*` channel is `forbidden` in `shared/mcp-coverage.ts` | BACKEND |
| Timers | `OXESPACE_E2E_AGENTS_NEEDS_YOU_MS`, `OXESPACE_E2E_AGENTS_NO_REPORT_MS` (e2e only) | BACKEND |
| Copy | `agents.state.*` namespace (en, pt-BR) | FRONTEND (DESIGN copy) |

Not in this CCR: the central's UI (S7.2), actions and the review drawer (S7.3), the phone screens (S7.4).

## 2. Shared types (`shared/types/agents.ts`)

```ts
/** §3.1, in precedence order: when several hold, the first wins, and the central sorts by it. */
export const AGENT_STATES = ['needs-you', 'failed', 'working', 'finished', 'idle', 'stopped', 'unknown'] as const
export type AgentState = typeof AGENT_STATES[number]

/** `thread` is a conversation (the same word as ExecutionOwner and #441); the phone shows it as "Conversation". */
export const AGENT_KINDS = ['pane', 'thread', 'delegation', 'work'] as const
export type AgentKind = typeof AGENT_KINDS[number]

export interface AgentKey { kind: AgentKind; id: string }

/** A pending request on this agent, as the approval center has it (B10): never built from agent text. */
export interface AgentRequestSummary {
  requestId: string
  /** Main-built title (C3). */
  title: MainMessage
  risk: ApprovalRisk            // the 4 words low/medium/high/critical, never colours (DESIGN FINDING M)
  /** False when this request can't be answered from where it is read (the phone, for some kinds). */
  answerable: boolean
  since: number
}

export interface AgentRow extends AgentKey {
  state: AgentState
  /** True when `state` is the renderer's timing guess for a pane (§3.2, "estimated"); main itself never estimates. */
  estimated?: boolean
  provider: 'claude' | 'codex' | 'other'
  /** The surface it lives in: OxeCode (panes, delegations, work runs) or OxeChat (conversations). */
  mode: 'code' | 'thread'
  title: string                 // pane/conversation/delegation/run name, cut to 200 chars
  since: number                 // when it entered `state`
  seenAt: number | null         // §3.4
  /** The native session id, or null. Desktop only: never on the phone. */
  session: string | null
  /** Its own worktree, if any. Desktop only: paths never reach the phone. */
  worktree: { path: string; branch: string | null } | null
  /** Lifetime cost of the agent so far, when its provider reports one; null otherwise. Desktop only. */
  cost: { usd: number } | null
  requests: AgentRequestSummary[]
  /** The agent that started it (a delegation's requester, a sub-agent's parent), for nesting. */
  parent?: AgentKey
  /** Short facts for the row (e.g. "3 of 5 tasks"), as C3 messages. */
  meta?: MainMessage[]
}

/** Each source answers on its own: one that fails never hides the others (§5.7). */
export type AgentSource = 'panes' | 'threads' | 'delegations' | 'work'
export type AgentSourceStatus = { ok: true; seq: number } | { ok: false; reason: MainMessage }

export interface AgentsOverview {
  rows: AgentRow[]
  sources: Record<AgentSource, AgentSourceStatus>
}

/** Pushed on every change; `seq` per source lets the window drop a stale event. */
export interface AgentsChange {
  upsert: AgentRow[]
  removed: AgentKey[]
  sources: Partial<Record<AgentSource, AgentSourceStatus>>
}
```

#441 reads `mode`, `cost`, `session`, `worktree` and `requests` on every row: all are present, `null` or `[]` when the
source has nothing.

## 3. The mapping (`shared/agents/agentState.ts`)

One pure function per source, all returning `AgentState`, with the exact table of spec §3.2. The contract test
(`tests/unit/agent-state.test.ts`) walks **every** source state, so a new source state fails the test until it is
placed:

| Source | needs-you | failed | working | finished | idle | stopped | unknown |
|---|---|---|---|---|---|---|---|
| Pane: lifecycle + terminal status | `blocked` | terminal `error` | `working`, terminal `starting` | `done` & unseen | `idle`; `done` & seen | stopped by the person | `unknown` |
| Conversation: `status`, `lastTurnStatus`, `pendingRequests`, `backgroundRunning`, observation | `approval`; `pendingRequests > 0`; observation `awaiting-input` | `failed` | `running`; `backgroundRunning > 0` | `idle` & last turn `completed` & unseen | `idle` otherwise | `interrupted` | (none) |
| Delegation: `DelegationState` + requester | `blocked`/`review` with the person as requester | `failed` | `preparing`, `starting`, `accepted`; `blocked`/`review` with an agent requester | `approved` & unseen | `approved` & seen | `cancelled`, `interrupted` | (none) |
| Work run: `WorkRunStatus` | `blocked` | `failed` | `running` | `succeeded` & unseen | `succeeded` & seen | `cancelled` | (none) |

- "Seen" is `seenAt !== null && seenAt >= finishedAt`.
- A terminal that exited without the person stopping it is not a state: its row is removed.
- The window's estimated pane tone (§3.2) stays a window concern: main sends `unknown`, and the window may show its
  own estimate with `estimated: true`. Main and the phone never estimate. That difference is tested.
- `activity.feed.ts`, `ModeSwitch`, `PaneSessionRow` and `ThreadSidebar` move onto this function in S7.1/S7.2 (§3.3).

## 4. Who has seen what (`agent_seen`, migration)

```sql
CREATE TABLE agent_seen (kind TEXT NOT NULL, id TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (kind, id));
```

- One row per agent, the newest mark only; at most 2000 rows, the oldest go first.
- A row goes when its source goes: a pane closed, a conversation deleted, a delegation or run pruned.
- Opening a row, or "Mark as seen", writes `seen_at = now`. The desktop does it through `agents:mark-seen`, the phone
  through `agent.markSeen`.
- Conversations: `unreadIds` leave renderer localStorage. On the first start after the update the window sends, once,
  a `markSeen` for every conversation it does **not** list as unread. That keeps today's read state; nothing else
  migrates.
- Migration number: main's highest + 1 at merge time (the gap guard is the arbiter).

## 5. Desktop channels (`shared/types/ipc/agents.ts`)

| Channel | Shape | MCP |
|---|---|---|
| `agents:overview` | `() => AgentsOverview` | forbidden: the person's overview of every agent |
| `agents:mark-seen` | `(key: AgentKey) => void`; an unknown key is ignored, never an error | forbidden: only the person marks what they have seen |
| `agents:changed` (event) | `AgentsChange`, within 1 s of a source changing (#441) | forbidden |

- **Preload** (`electron/preload/agents.ts`, its own module, not `api.ts`): `window.oxe.agents.overview()`,
  `markSeen(key)` and `onChanged(listener) => unsubscribe`.
- **Validation:** `markSeen` takes `{ kind ∈ AGENT_KINDS, id: string ≤ 200 }`. Anything else is a plain `Error`
  (malformed input, per C3).
- **C3 codes** for the per-source status: `agents.source.unavailable { source }`, and
  `agents.source.timedOut { source }` (a source that didn't answer within 2 s).
- **e2e double:** `electron/main/e2e/agents-mock.ts`, registered from mock-ipc's per-domain hook. The
  `OXESPACE_E2E_AGENTS` fixture can keep one agent silent (§14).

## 6. Phone: C5 block (`shared/remote/protocol.ts`, MOBILE #347)

```ts
REMOTE_SUBSCRIPTIONS += 'agents'
REMOTE_COMMANDS += 'agent.markSeen'
export const REMOTE_AGENT_STATES = AGENT_STATES          // the same 7, in order
export const REMOTE_AGENT_KINDS = AGENT_KINDS            // pane, thread, delegation, work

export interface RemoteAgentRow {
  kind: RemoteAgentKind; id: string
  state: RemoteAgentState
  provider: 'claude' | 'codex' | 'other'
  title: string                       // redacted like other remote text, ≤ REMOTE_TEXT_LIMITS.title
  since: number
  /** The oldest pending request, if any; the phone shows one per row. */
  request?: { requestId: string; title: string; risk: ApprovalRisk; answerable: boolean }
  /** Set while state is needs-you: when the phone may nudge (§5.10 timer, the same setting as the desktop). */
  nudgeAfterMs?: number
}
/** Snapshot: every row; events: upserts and removals, like `threads`. */
export interface RemoteAgentsSnapshot { rows: RemoteAgentRow[]; unavailable: RemoteAgentSource[] }
export interface RemoteAgentsEvent { upsert: RemoteAgentRow[]; removed: { kind: RemoteAgentKind; id: string }[]; unavailable: RemoteAgentSource[] }
```

- **Never on the phone:** paths, worktrees, session ids, per-row cost, `meta` detail beyond counts. The phone does not
  re-implement the mapping; rows arrive already mapped (rule 4).
- **Risk:** the phone shows the 4-level `ApprovalRisk` words, never green/orange/red (DESIGN FINDING M).
- **`answerable`:** false for a pane request and for anything only the desktop can answer. The phone then shows
  "Answer on the computer" (§8).
- **`agent.markSeen` `{ kind, id }`:** idempotent. It goes through the same rate limit as other commands, and it
  never reveals whether a key exists (an unknown key is `ok`).
- **Generated Kotlin:** the implementing PR runs `android:generate` and commits the Kotlin; line-ending-only churn is
  reverted.

## 7. MCP coverage

`shared/mcp-coverage.ts` gains `'agents.overview'` as a **forbidden** capability, with
`ipc: ['agents.overview', 'agents.markSeen', 'agents.changed']`: "the person's view of every agent; an agent reads
its own state through its own tools". `tests/mcp-coverage.test.ts` and #441's check (`forbidden|excluded`) enforce it.

## 8. Testable timers (#333, §14)

| Variable | Default | Read |
|---|---|---|
| `OXESPACE_E2E_AGENTS_NEEDS_YOU_MS` | 120 000 (the setting's 2 min) | main, needs-you timer (§5.10) |
| `OXESPACE_E2E_AGENTS_NO_REPORT_MS` | 10 000 | main, "no report after Stop" (§13) |

Both are honoured only in e2e builds, like `OXESPACE_E2E_APPROVALS_TTL_MS`, and ignored otherwise. There is no fake
clock.

## 9. Order (proposal; TECH LEAD decides)

1. Types, mapping, contract test, `agent_seen` migration, desktop channels, preload, mock, MCP coverage. #441 turns
   green here.
2. The C5 block plus `android:generate` (MOBILE's #347 can then go on). SECURITY reviews this PR.
3. Moving `activity.feed.ts`, `ModeSwitch`, `PaneSessionRow` and `ThreadSidebar` onto the mapping (FRONTEND, S7.2).

Each step keeps the main entry within +2 kB: the read model loads on the first `agents:overview` (lazy, like T44).

## 10. Open for review

- `thread` vs `conversation` as the kind's wire name: this CCR uses `thread`, because #441 and `ExecutionOwner` do.
- Sub-agents as rows: not in v1. They nest through `parent` once the timeline's `subagent` items carry a stable key.
- `cost`: the conversation's lifetime total from `ThreadCostReport`. Panes have none until the hooks report it.
