/* OxeMobile mock data for the phone section. Shapes follow shared/remote/protocol.ts (C5) and the S7.1 agents model,
   so nothing here needs a protocol change. Same fictional company and computer as the desktop playground. */
export const PC = { name: 'MARINA-DESKTOP', os: 'Windows 11', since: '3 Nov', phone: 'Pixel 8a · Marina' }

/** RemoteThreadSummary: status idle | running | approval | interrupted | failed. Workspace is a name only (no color in C5). */
export interface PThread { id: string; title: string; prov: 'claude' | 'codex'; status: 'idle' | 'running' | 'approval' | 'interrupted' | 'failed'; ws: string; at: string; ask?: string; bg?: number }
export const THREADS: PThread[] = [
  { id: 't147', title: 'Add a Pix refund endpoint', prov: 'claude', status: 'approval', ws: 'cajui-api', at: '9 min', ask: 'Asks you 2 questions' },
  { id: 't143', title: 'Find why the monthly invoice report takes 40 s', prov: 'codex', status: 'approval', ws: 'cajui-api · t143', at: '37 min', ask: 'Asks to update 1,284 rows' },
  { id: 't144', title: 'Test Pix webhooks against the sandbox', prov: 'claude', status: 'approval', ws: 'cajui-api', at: '31 min', ask: 'Asks to remove a volume' },
  { id: 't142', title: 'Make charge creation idempotent', prov: 'claude', status: 'running', ws: 'cajui-api · t142', at: '44 min', bg: 1 },
  { id: 't141', title: 'Add CSV export to the statements page', prov: 'claude', status: 'idle', ws: 'cajui-web', at: '11:20' },
  { id: 't145', title: 'Move docker-compose to Postgres 17', prov: 'codex', status: 'failed', ws: 'cajui-infra', at: '13:30' },
  { id: 't139', title: 'Fix the login redirect loop on expired sessions', prov: 'claude', status: 'idle', ws: 'cajui-web', at: '09:12' }
]

/** Requests the phone sees. kind: approval | question. phoneAnswerable false = answered on the computer only. */
export type Risk = 'low' | 'medium' | 'high' | 'critical'
export interface PRequest { id: string; thread: string; kind: 'approval' | 'question'; title: string; risk?: Risk; answerable: boolean; where?: string; tool?: string; cmd?: string; files?: string[]; notes?: string[]; why?: string; at: string; hidden?: boolean }
export const REQUESTS: PRequest[] = [
  { id: 'r-vol', thread: 't144', kind: 'approval', title: 'Remove the pix-mock-data volume', risk: 'critical', answerable: true, where: 'Local Docker', tool: 'Bash', cmd: 'docker volume rm pix-mock-data', files: [], notes: ['Deletes 3 days of webhook fixtures', 'Nothing in the change set uses it'], why: 'The sandbox replays old webhooks from this volume and the tests count them twice.', at: '31 min' },
  { id: 'r-sql', thread: 't143', kind: 'approval', title: 'Update 1,284 invoices on billing-staging', risk: 'critical', answerable: false, where: 'billing-staging (Postgres)', tool: 'OxeQuery', cmd: "UPDATE invoices SET status = 'paid'\nWHERE status = 'open' AND charge_settled_at IS NOT NULL;", at: '37 min' },
  { id: 'r-q', thread: 't147', kind: 'question', title: 'The agent has 2 questions', answerable: true, at: '9 min' },
  { id: 'r-hid', thread: 't142', kind: 'approval', title: 'Delete a build script', risk: 'high', answerable: true, where: 'project folder', tool: 'Bash', cmd: 'rm -rf ~/‮txt.sh', notes: ['Deletes files outside the change set'], why: 'The old script breaks the redirect test.', at: '3 min', hidden: true }
]
export const QUESTIONS: { q: string; multi: boolean; opts: [string, string][] }[] = [
  { q: 'A refund request is larger than what is left on the charge. What should happen?', multi: false, opts: [['Reject it with 422', 'The merchant sends a new request with the right amount. Recommended.'], ['Refund what is left', 'Silently lower the amount to the balance.']] },
  { q: 'Which events should notify the merchant?', multi: true, opts: [['Refund requested', 'When we accept the request.'], ['Refund completed', 'When the PSP says DEVOLVIDO.'], ['Refund failed', 'When the PSP says NAO_REALIZADO.']] }
]

/** S7.1 agent rows, flat on the phone (no workspace grouping in 1.5.0). The 7 states in the phone's words. */
export type AState = 'needs-you' | 'failed' | 'working' | 'finished' | 'idle' | 'stopped' | 'unknown'
export const AWORD: Record<AState, string> = { 'needs-you': 'Needs you', failed: 'Failed', working: 'Working', finished: 'Finished', idle: 'Idle', stopped: 'Stopped', unknown: 'Not confirmed' }
export interface PAgent { id: string; kind: 'thread' | 'pane' | 'delegation' | 'work'; title: string; prov: 'claude' | 'codex'; state: AState; since: string; parent?: string }
export const AGENTS: PAgent[] = [
  { id: 't147', kind: 'thread', title: 'Add a Pix refund endpoint', prov: 'claude', state: 'needs-you', since: 'for 9 min' },
  { id: 't143', kind: 'thread', title: 'Find why the monthly invoice report takes 40 s', prov: 'codex', state: 'needs-you', since: 'for 37 min' },
  { id: 't144', kind: 'thread', title: 'Test Pix webhooks against the sandbox', prov: 'claude', state: 'needs-you', since: 'for 31 min' },
  { id: 't145', kind: 'thread', title: 'Move docker-compose to Postgres 17', prov: 'codex', state: 'failed', since: 'since 13:30' },
  { id: 't142', kind: 'thread', title: 'Make charge creation idempotent', prov: 'claude', state: 'working', since: 'for 44 min' },
  { id: 'd-147', kind: 'delegation', title: 'Review the refund migration', prov: 'codex', state: 'working', since: 'for 3 min', parent: 'Add a Pix refund endpoint' },
  { id: 'p-kc', kind: 'pane', title: 'Claude Code in cajui-web', prov: 'claude', state: 'idle', since: 'since 14:31' },
  { id: 't141', kind: 'thread', title: 'Add CSV export to the statements page', prov: 'claude', state: 'finished', since: 'since 11:20' },
  { id: 'w-audit', kind: 'work', title: 'Nightly dependency audit', prov: 'codex', state: 'unknown', since: 'since 03:00' }
]

/** RemoteWorkspace { id, name, active, panes } with RemotePane { title, kind, agent, agentState }. */
export const TERMINALS: { ws: string; panes: { id: string; title: string; kind: 'terminal' | 'agent'; agent?: 'claude' | 'codex'; state?: string; typing: boolean }[] }[] = [
  { ws: 'cajui-api · t142', panes: [{ id: 'k2', title: 'npm run dev', kind: 'terminal', typing: true }, { id: 'k1', title: 'Claude', kind: 'agent', agent: 'claude', state: 'Working', typing: false }] },
  { ws: 'cajui-api · t143', panes: [{ id: 'k3', title: 'Codex', kind: 'agent', agent: 'codex', state: 'Needs your decision', typing: false }] },
  { ws: 'cajui-web', panes: [{ id: 'kc', title: 'Claude', kind: 'agent', agent: 'claude', state: 'Idle', typing: false }, { id: 'kz', title: 'zsh', kind: 'terminal', typing: false }] }
]
export const JOBS: { title: string; state: 'running' | 'failed' | 'done'; sub: string }[] = [
  { title: 'Dev server', state: 'running', sub: 'cajui-api · t142 · started 14:02' },
  { title: 'Unit tests', state: 'failed', sub: 'cajui-api · exit code 1 · 14:21' },
  { title: 'Nightly backup', state: 'done', sub: 'cajui-infra · 03:00' }
]

/** A VT screen (T97/T98): fixed cols × rows, styled cells. [text, class] runs per row. */
export const VT_COLS = 80
export const VT_ROWS: [string, string][][] = [
  [['marina@desktop', 'g'], [':', ''], ['~/cajui-api/t142', 'b'], ['$ ', ''], ['npm run dev', '']],
  [['', '']],
  [['> cajui-api@2026.11.2 dev', 'm']],
  [['> tsx watch src/server.ts', 'm']],
  [['', '']],
  [['  VITE ', 'gB'], ['v7.1.2', 'g'], ['  ready in ', 'm'], ['412', 'w'], [' ms', 'm']],
  [['', '']],
  [['  ➜  ', 'g'], ['Local:   ', 'w'], ['http://localhost:3001/', 'c']],
  [['  ➜  ', 'm'], ['TOKEN=', 'w'], ['[hidden by your computer]', 'hid']],
  [['[14:40:12] ', 'm'], ['POST /charges ', 'w'], ['201', 'g'], [' (idempotency-key=ab12…) 18 ms', 'm']],
  [['[14:40:12] ', 'm'], ['POST /charges ', 'w'], ['200', 'g'], [' (replayed) 4 ms', 'm']],
  [['warn', 'y'], [" deprecated option 'base'", '']],
  [['', '']]
]
