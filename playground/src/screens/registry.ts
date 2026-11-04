/* Every screen in the playground, grouped as in README.md. tag: '1.5.0' ships in 1.5.0 (lite B);
   'later' needs the full Task entity (later, full B). stage: 2 arrives in the second push of this PR. */
import { S, emit, scState, task, resetState } from '../state/store'

export interface Screen { id: string; group: string; name: string; tag: '1.5.0' | 'later'; stage?: 2; plan: string[]; desc: string; tries: string[]; go: () => void }
const T = (id: string, tab = 'conv', extra?: () => void) => () => { S.area = 'task'; S.emptyWs = false; S.taskId = id; S.tab = tab; S.sbCol = false; S.rp = true; S.rp900 = false; S.rpTab = 'overview'; Object.values(S.sideChat).forEach(s => { s.open = false }); extra && extra() }

export const SCREENS: Screen[] = [
  { id: 'first-run', group: 'Shell', name: 'First run, nothing set up', tag: '1.5.0', plan: ['A1', 'G-01'], desc: 'One primary action. The checklist collapses to its next step; the other modes are tiles, not links.', tries: ['Pick a project folder', 'Open a mode tile without a task'], go: () => { S.area = 'firstrun' } },
  { id: 'home-empty', group: 'Shell', name: 'Workspace with no tasks', tag: '1.5.0', plan: ['C-05', 'X10'], desc: 'The empty state names what a task is and offers four starts in a 2 × 2 grid.', tries: ['Press N', 'Pick a suggestion: it fills New task'], go: () => { T('t143')(); S.emptyWs = true } },
  { id: 'task-approval', group: 'Task view', name: 'Task waiting for an approval (Codex, SQL)', tag: '1.5.0', plan: ['T58-a/b/c', 'T67', 'U13'], desc: 'T-143. The approval sits in the conversation, docked above the composer and on the right panel. Deny is the default everywhere.', tries: ['See impact → hold Approve, or Snapshot, then approve', 'Expand a tool row (the failed lint shows its error)', 'Press D to deny from the dialog'], go: T('t143') },
  { id: 'task-running', group: 'Task view', name: 'Task running (Claude, Stop and steer)', tag: '1.5.0', plan: ['T58-d/e', 'C-07'], desc: 'T-142 keeps working while you watch: tool rows arrive, a checkpoint is made, then it asks to push.', tries: ['Type a note and press the compass to steer', 'Stop it (danger button)', 'Change the model chip: the dashed border means "next message"'], go: T('t142') },
  { id: 'task-push', group: 'Task view', name: 'Reversible approval (git push)', tag: '1.5.0', plan: ['T67'], desc: 'A reversible request: Approve is a normal primary, no hold. The undo toast stays 6 s.', tries: ['Approve and watch PR #321 appear on the PR tab'], go: () => { T('t142')() } },
  { id: 'task-error', group: 'Task view', name: 'Task stopped with an error', tag: '1.5.0', plan: ['X4', 'C-03'], desc: 'One danger callout says what failed and what to do. Never the same failure three times.', tries: ['Retry with a fresh volume'], go: T('t145') },
  { id: 'task-terminal', group: 'Task view', name: 'Task · Terminal', tag: '1.5.0', plan: ['U12', 'K-01'], desc: 'Terminals in the task\'s worktree, the agent\'s and yours.', tries: ['Open the pane menu: RTK, Caveman and Semantic have hint lines'], go: T('t142', 'terminal') },
  { id: 'task-queries', group: 'Task view', name: 'Task · Queries', tag: '1.5.0', plan: ['U12', 'T63'], desc: 'Every query the agent ran for this task, from the U12 read model. The pending write links to its approval.', tries: ['Select the waiting UPDATE', 'Open in OxeQuery'], go: T('t143', 'queries') },
  { id: 'task-requests', group: 'Task view', name: 'Task · Requests', tag: '1.5.0', plan: ['U12', 'T64'], desc: 'HTTP requests the agent sent. Secrets show as •••• (NAME). The production call was blocked by policy.', tries: ['Open the blocked request'], go: () => { T('t144', 'requests')(); S.post.req = 'r6' } },
  { id: 'task-containers', group: 'Task view', name: 'Task · Containers', tag: '1.5.0', plan: ['U12'], desc: 'Containers the agent started, with their logs.', tries: ['Select pix-mock', 'Open in OxePod'], go: T('t144', 'containers') },
  { id: 'task-changes', group: 'Task view', name: 'Task · Changes', tag: '1.5.0', plan: ['A2'], desc: 'The worktree diff against main, with Finish the worktree.', tries: ['Finish the worktree…', 'Discard all… (confirm, Cancel focused)'], go: T('t142', 'changes') },
  { id: 'task-pr', group: 'Task view', name: 'Task · Pull request', tag: '1.5.0', plan: ['ThreadWorktreeFinish'], desc: 'An open PR with checks and reviewers. On T-142 the same tab is the Open a pull request form.', tries: ['Switch to T-142 to see the form'], go: T('t141', 'pr') },
  { id: 'task-details', group: 'Task view', name: 'Conversation details', tag: '1.5.0', plan: ['T58-g', '§7a'], desc: 'Summary header with the same chips as the composer, then disclosures with summaries. It scrolls.', tries: ['Open and close sections with Enter', 'Click the model chip'], go: T('t142', 'conv', () => { S.rpTab = 'details'; S.rp900 = true }) },
  { id: 'side-chat', group: 'Task view', name: 'Side chat', tag: '1.5.0', plan: ['T58-i', 'T60', '§7c'], desc: 'A read-only copy. Close keeps it (switch tasks and come back); Discard asks first when there are answers.', tries: ['Ask a suggested question', 'Close it, open another task, come back', 'Esc moves focus back to the conversation'], go: T('t143', 'conv', () => { scState(task('t143')!).open = true }) },
  { id: 'sidebar-rail', group: 'Shell', name: 'Task list collapsed', tag: '1.5.0', plan: ['T61'], desc: 'Collapsed, the list keeps every task: status glyph, key and a tooltip with the title.', tries: ['Hover a glyph', 'Ctrl B toggles'], go: T('t143', 'conv', () => { S.sbCol = true }) },
  { id: 'palette', group: 'Shell', name: 'Command palette', tag: '1.5.0', plan: ['ui/CommandPalette'], desc: 'Tasks, approvals, what agents ran, modes and settings in one list.', tries: ['Type "update" or "T-144"', '↑↓ and Enter'], go: () => { T('t143')(); S.overlay = { type: 'pal', query: '', sel: 0 } } },
  { id: 'notifications', group: 'Shell', name: 'Notifications', tag: '1.5.0', plan: ['C-12'], desc: 'The sun dot means "needs you". Opening one opens its task.', tries: ['Open the T-145 failure'], go: () => { T('t143')(); S.notif = true } },
  { id: 'approve-sql', group: 'Approvals', name: 'Impact preview: database write', tag: '1.5.0', plan: ['T67', 'C-01'], desc: 'Where it runs, rows before → after, whether it can be undone, the exact SQL. Snapshot, then approve is offered for writes.', tries: ['Hold Approve 1.2 s (pointer, Space or A)', 'Release early: nothing happens', 'S takes the snapshot first'], go: () => { T('t143')(); S.overlay = { type: 'approve', id: 'ap_sql' } } },
  { id: 'approve-volume', group: 'Approvals', name: 'Impact preview: delete a volume', tag: '1.5.0', plan: ['T67'], desc: 'An irreversible local action with no snapshot: hold to approve only.', tries: ['D denies'], go: () => { T('t144')(); S.overlay = { type: 'approve', id: 'ap_down' } } },
  { id: 'queue', group: 'Approvals', name: 'Approval queue', tag: '1.5.0', plan: ['S7.1'], desc: 'Every pending request across tasks, with the same impact preview. J and K move.', tries: ['Deny one with D', 'Decided today keeps a record'], go: () => { S.area = 'queue' } },
  { id: 'new-task', group: 'Shell', name: 'New task', tag: '1.5.0', plan: ['U5a', 'thread-create-dialog'], desc: 'In 1.5.0 a new task is a new conversation with its own worktree.', tries: ['Write a goal and start it: it runs and answers with a plan'], go: () => { T('t143')(); S.overlay = { type: 'newtask', text: '' } } },
  { id: 'mode-code', group: 'Modes', name: 'OxeCode', tag: '1.5.0', plan: ['A2', 'K-01', 'K-02'], desc: 'Panes, terminals, worktrees and sessions to resume, with no task needed. A pane started by an agent says so and carries its task key.', tries: ['Type git status in a pane of yours', 'Resume a session: it opens in a new pane', 'Layout: grid, stacked, focused pane only', 'The pane menu explains RTK, Caveman and Semantic'], go: () => { S.area = 'mode'; S.mode2 = 'code' } },
  { id: 'mode-query', group: 'Modes', name: 'OxeQuery', tag: '1.5.0', stage: 2, plan: ['A5', 'Q-01'], desc: 'Connections, editor and results.', tries: [], go: () => { S.area = 'mode'; S.mode2 = 'query'; S.q.tab = 'editor' } },
  { id: 'mode-query-activity', group: 'Modes', name: 'OxeQuery · Agent activity', tag: '1.5.0', stage: 2, plan: ['T63', 'U12'], desc: 'What agents ran, with the row-detail modal.', tries: [], go: () => { S.area = 'mode'; S.mode2 = 'query'; S.q.tab = 'activity' } },
  { id: 'mode-post', group: 'Modes', name: 'OxePost', tag: '1.5.0', stage: 2, plan: ['A4', 'T62', 'H-01'], desc: 'Collections, a working New request, the response.', tries: [], go: () => { S.area = 'mode'; S.mode2 = 'post'; S.post.activity = false } },
  { id: 'mode-post-activity', group: 'Modes', name: 'OxePost · Agent activity', tag: '1.5.0', stage: 2, plan: ['T64'], desc: 'Requests agents sent, with the detail modal.', tries: [], go: () => { S.area = 'mode'; S.mode2 = 'post'; S.post.activity = true } },
  { id: 'mode-pod', group: 'Modes', name: 'OxePod', tag: '1.5.0', stage: 2, plan: ['A3', 'P-01'], desc: 'Containers, logs and actions; Remove and Down in the ⋯ menu.', tries: [], go: () => { S.area = 'mode'; S.mode2 = 'pod' } },
  { id: 'chat', group: 'Modes', name: 'OxeChat, quick chat', tag: '1.5.0', plan: ['T58', 'C-05'], desc: 'A conversation with no project, read only. Same bubbles, chips and composer as a task. Turn into a task carries the question over.', tries: ['Ask something: it answers', 'New chat shows the 2 × 2 suggestions', 'Turn into a task…'], go: () => { S.area = 'chat' } },
  { id: 'settings-general', group: 'Settings', name: 'Settings (every page)', tag: '1.5.0', stage: 2, plan: ['U2', 'U8'], desc: 'Apply at once, undo toasts for risky changes, confirm for irreversible deletes.', tries: [], go: () => { S.area = 'settings'; S.page = 'general' } },
  { id: 'settings-approvals', group: 'Settings', name: 'Settings · Approvals', tag: '1.5.0', stage: 2, plan: ['U2'], desc: '', tries: [], go: () => { S.area = 'settings'; S.page = 'approvals' } },
  { id: 'settings-notifications', group: 'Settings', name: 'Settings · Notifications', tag: '1.5.0', stage: 2, plan: ['S-05'], desc: '', tries: [], go: () => { S.area = 'settings'; S.page = 'notifications' } },
  { id: 'settings-ws', group: 'Settings', name: 'Settings · Workspace', tag: '1.5.0', stage: 2, plan: ['G-10'], desc: '', tries: [], go: () => { S.area = 'settings'; S.page = 'ws-projects' } },
  { id: 'dialogs', group: 'Dialogs', name: 'Every dialog from the #569 audit', tag: '1.5.0', stage: 2, plan: ['U1', 'U5a/b/c'], desc: '', tries: [], go: () => { S.area = 'settings'; S.page = 'dialogs' } },
  { id: 'foundations', group: 'Foundations', name: 'Foundations: tokens and components', tag: '1.5.0', stage: 2, plan: ['U3', 'U4', 'C4'], desc: '', tries: [], go: () => { S.area = 'found' } },
  { id: 'later-multi', group: 'Later (full B)', name: 'Task with two agents', tag: 'later', plan: ['Task entity'], desc: 'One task owning two conversations (Claude and Codex). Needs the Task entity and an Android protocol change, so not in 1.5.0.', tries: ['Compare with T-143 in 1.5.0'], go: () => { T('t143')(); S.area = 'later-multi' } },
  { id: 'later-watch', group: 'Later (full B)', name: 'Watch running tasks', tag: 'later', plan: ['Task entity'], desc: 'A live board of every running task. 1.5.0 has the task list and notifications instead.', tries: ['See impact on the column that needs you'], go: () => { S.area = 'later-watch' } }
]

/** Which screen the current state shows, so the chrome follows clicks inside the app. */
export function computeScreen (): string {
  const a = S.area
  if (a === 'firstrun' || a === 'queue' || a === 'chat' || a === 'later-watch' || a === 'later-multi') return a === 'firstrun' ? 'first-run' : a
  if (a === 'found') return 'foundations'
  if (a === 'mode') return 'mode-' + S.mode2 + ((S.mode2 === 'query' && S.q.tab === 'activity') || (S.mode2 === 'post' && S.post.activity) ? '-activity' : '')
  if (a === 'settings') return S.page === 'dialogs' ? 'dialogs' : SCREENS.some(s => s.id === 'settings-' + S.page) ? 'settings-' + S.page : 'settings-general'
  if (S.emptyWs) return 'home-empty'
  if (S.sbCol) return 'sidebar-rail'
  if (S.sideChat[S.taskId]?.open) return 'side-chat'
  if (S.tab !== 'conv') return 'task-' + S.tab
  if (S.rp && S.rpTab === 'details') return 'task-details'
  return S.taskId === 't142' ? (S.tasks.find(t => t.id === 't142')?.gate === 'ap_push' ? 'task-push' : 'task-running') : S.taskId === 't145' ? 'task-error' : 'task-approval'
}
export function syncScreen () { S.screen = computeScreen(); try { history.replaceState(null, '', '#' + S.screen) } catch { /* sandboxed */ } }
export function goScreen (id: string) {
  if (id === 'task-current') { S.area = 'task'; S.overlay = null; S.notif = false; syncScreen(); emit(); return }
  const s = SCREENS.find(x => x.id === id); if (!s) return
  S.overlay = null; S.menu = null; S.notif = false
  s.go(); S.screen = id
  try { history.replaceState(null, '', '#' + id) } catch { /* sandboxed */ }
  emit()
}
export function resetAll () { resetState(); goScreen(S.screen) }
