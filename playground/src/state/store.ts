/* One mutable state object and a version counter. Actions mutate S and call emit(); the root re-renders.
   Simple on purpose: the playground is a reference for looks and flows, not for app architecture. */
import { useSyncExternalStore } from 'react'
import { D } from '../mock/data'
import { T147, T147_CONV } from '../mock/thread'
import { T147_CHANGES } from '../mock/locations'
D.changes.t147 = T147_CHANGES
import type { Access, ConvItem, Task } from '../mock/types'

export type Area = 'task' | 'queue' | 'firstrun' | 'mode' | 'settings' | 'found' | 'dialogs' | 'chat' | 'later-watch' | 'later-multi'
export type Mode2 = 'code' | 'query' | 'post' | 'pod'
export interface Toast { id: number; text: string; kind?: 'attn' | 'err'; undo?: () => void; go?: string }
export interface MenuState { id: string; x: number; y: number; r: number; top: number; pop?: boolean }
export interface Overlay { type: string; id?: string; ck?: number | string; text?: string; q?: string; r?: string; c?: string; sel?: number; query?: string }
export interface Cmp { mode: 'plan' | 'agent'; model: string; effort: string; access: Access; pend: Partial<Record<'model' | 'effort' | 'access', boolean>> }
export interface SideChat { open: boolean; msgs: { q?: string; a?: string; busy?: boolean }[]; draft: string; model: string; effort: string }

export const SETTINGS_DEFAULT = {
  theme: 'system', density: 'comfortable', textSize: 14, lang: 'en', startup: 'last', autoApproveReads: true, bypassResume: false, network: 'ask', retention: '90',
  notifyApprovals: true, notifyDone: true, notifySound: false, termFont: 13, termCursor: 'bar', shell: 'bash', scrollback: 10000, sendTelemetry: false, crashReports: true,
  defaultAgent: 'claude', phoneOn: true, editor: 'code', memoryOn: false, claudeModel: 'Opus 5.5', claudeEffort: 'High', codexModel: 'GPT-5 Codex', defaultAccess: 'edit', worktreeDefault: true,
  mcpOn: { github: true, linear: true, sentry: true, figma: false } as Record<string, boolean>,
  skillOn: { 'pix-rules': true, migrations: true, 'release-notes': false, pdf: true } as Record<string, boolean>
}

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))
/** OxeChat on its own: a read-only conversation with no project. It never shows in the task list. */
const QUICK: Task = { id: 'quick', key: 'Chat', title: 'Quick chat', project: 'api', prov: 'claude', model: 'Opus 5.5', effort: 'Medium', access: 'read', status: 'done', branch: 'no project', worktree: false, started: '14:30', mins: 1, cost: 0.02, ctx: [3, '6k', '200k'], counts: { terminal: 0, queries: 0, requests: 0, containers: 0, changes: 0, pr: 0 }, now: 'Answered' }
const QUICK_CONV: ConvItem[] = [{ you: 'What’s the Pix rule for refunds after 90 days?', at: '14:30' }, { agent: 'A Pix refund (<i>devolução</i>) can be requested up to <b>90 days</b> after the original payment. After that the payer’s bank rejects it, so you send a new Pix to the customer instead. Partial refunds count against the same 90-day window.', at: '14:30' }]
function fresh () {
  return {
    area: 'task' as Area, taskId: 't143', tab: 'conv', mode2: 'query' as Mode2, page: 'general',
    sbCol: false, rp: false, rpTab: 'overview' as 'overview' | 'details', sideChat: {} as Record<string, SideChat>, menu: null as MenuState | null,
    notif: false, overlay: null as Overlay | null, toasts: [] as Toast[], projFilter: null as string | null,
    tasks: ([clone(T147)].concat(clone(D.tasks), [QUICK]) as Task[]).map(t => Object.assign(t, { key: t.title })), conv: Object.assign(clone(D.conv), { quick: clone(QUICK_CONV), t147: clone(T147_CONV) }) as Record<string, ConvItem[]>, resolved: {} as Record<string, string>, queue: ['ap_sql', 'ap_down'],
    open: {} as Record<string, boolean>, disc: { ctx: true, tools: true } as Record<string, boolean>, past: {} as Record<string, number>,
    cmp: {} as Record<string, Cmp>, drafts: {} as Record<string, string>, notifRead: {} as Record<string, boolean>, extraNotifs: [] as typeof D.notifications,
    emptyWs: false, holding: null as string | null, bigText: false, verbose: false, queueSel: 0, tick: 0, running: { t142: 72, t147: 18 } as Record<string, number>,
    q: { conn: 'billing-staging', tab: 'editor', sel: 'q4', act: null as string | null, sql: undefined as string | undefined, qtab: 0 as number | undefined, untitled: '' as string | undefined }, tFilter: '' as string | undefined, qRunning: false, qRan: false,
    post: { col: 'pix', req: 'r1', tab: 'body', raw: false as boolean | undefined, body: {} as Record<string, string> | undefined, env: 'sandbox' as string | undefined, activity: false, newReq: null as null | { name: string; method: string; url: string; status?: number; ms?: number; size?: string; resBody: string }, sending: false, sentNew: false },
    pod: { sel: 'api', tab: 'logs' }, filter: '', renameTo: '', npSel: undefined as { project: string; wt: string } | undefined, wbRO: undefined as string | undefined, fr: { folder: false, claude: 'found', codex: 'missing' } as { folder: boolean; claude: string; codex: string }, hunkNote: {} as Record<string, string> | undefined, changesView: 'all' as string | undefined, irrevOk: false as boolean | undefined, cellA: null as string | null, cellTab: {} as Record<string, string>, dockTool: {} as Record<string, string>, dockOpen: {} as Record<string, string[]>, chatDockW: undefined as number | undefined, chatDockMax: false, codeRfr: undefined as number[] | undefined, dragPane: null as number | null, dragOver: null as number | null, gutterCtx: undefined as { row: boolean; j: number } | undefined, codeDockW: undefined as number | undefined, dockCollapsed: false as boolean | undefined, driftDismissed: {} as Record<string, boolean> | undefined, phoneTyping: [] as string[] | undefined, pairStep: 0 as number | undefined, pathOpen: {} as Record<string, string> | undefined, codeFr: undefined as number[] | undefined, codeMax: null as number | null, codeDock: undefined as string | undefined, wbFile: undefined as string | undefined, wbTabs: undefined as string[] | undefined, wbEdits: {} as Record<string, string> | undefined, wbUrl: undefined as string | undefined, wbSearch: undefined as string | undefined, wbSem: false as boolean | undefined, split2: null as string | null, extraTabs: {} as Record<string, string[]>, sideGroup: 'status' as 'status' | 'project', answers: {} as Record<string, string[]> | undefined, bgState: {} as Record<string, string> | undefined, queued: { t147: ['Also write every refund to the audit table'] } as Record<string, string[]>, fdPulse: 0 as number | undefined, connAgent: {} as Record<string, string> | undefined, colAgent: {} as Record<string, string> | undefined, kFilter: '' as string | undefined, keys: {} as Record<string, string> | undefined, unpaired: [] as string[] | undefined, removedProj: [] as string[] | undefined, actSrc: 'all' as string | undefined, sFilter: '' as string | undefined, podAgent: false as boolean | undefined, ncEnv: 'staging' as string | undefined, impPick: 0 as number | undefined, rp900: false, finishPick: 0,
    newTask: null as null | { project: string; prov: string; model: string; access: string; worktree: boolean }, code: { focus: 0 }, codePanes: null as null | (import('../mock/types').Term & { tag?: string; branch?: string; prov?: string; moved?: string; project?: string })[], codeWt: 1 as number | undefined, codeLayout: 'grid' as string | undefined, codeDraft: {} as Record<string, string> | undefined, set: clone(SETTINGS_DEFAULT), quickBusy: false, ckExtra: {} as Record<string, number>
  }
}
export type AppState = ReturnType<typeof fresh> & {
  w: 1440 | 900; mode: 'light' | 'dark'; view: 'live' | 'loading' | 'empty' | 'error'; screen: string; paused: boolean; scale: number
}
const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
export const S: AppState = Object.assign(fresh(), { w: 1440 as const, mode: (prefersDark ? 'dark' : 'light') as 'light' | 'dark', view: 'live' as const, screen: 'task-approval', paused: false, scale: 1 })
export function resetState () { Object.assign(S, fresh()) }

let version = 0
const subs = new Set<() => void>()
export function emit () { version++; subs.forEach(f => f()) }
export function useStore () { useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => version); return S }
/** Run an action and re-render. */
export const run = (fn: () => void) => () => { fn(); emit() }

/* ------------------------------------------------------------------ helpers */
export const task = (id: string) => S.tasks.find(t => t.id === id)
export const cur = () => task(S.taskId) as Task
export const prov = (id: string) => D.providers[id]
export const H = () => (S.w === 900 ? 620 : 900)
export const plural = (n: number, one: string, many?: string) => `${n.toLocaleString('en')} ${n === 1 ? one : (many || one + 's')}`
export const money = (n: number) => '$' + n.toFixed(2)
export const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
export const needsN = () => S.area === 'firstrun' ? 0 : S.queue.filter(q => !S.resolved[q]).length + S.tasks.filter(t => t.ask).length

let toastN = 0
export function toast (text: string, opts: Partial<Toast> = {}) {
  const t: Toast = Object.assign({ id: ++toastN, text }, opts)
  S.toasts.push(t); if (S.toasts.length > 3) S.toasts.shift()
  setTimeout(() => { S.toasts = S.toasts.filter(x => x.id !== t.id); emit() }, opts.undo ? 6000 : 3800)
}

/* Menus open below their trigger, in frame coordinates (the frame is scaled to fit the stage). */
export let appEl: HTMLElement | null = null
export const setAppEl = (el: HTMLElement | null) => { appEl = el }
export function openMenu (id: string, el: HTMLElement, pop = false) {
  if (S.menu && S.menu.id === id) { S.menu = null; return }
  if (!appEl) return
  const ar = appEl.getBoundingClientRect(), r = el.getBoundingClientRect(), sc = S.scale
  S.menu = { id, pop, x: (r.left - ar.left) / sc, y: (r.bottom - ar.top) / sc + 4, r: (ar.right - r.right) / sc, top: (r.top - ar.top) / sc }
}

export function cmpState (t: Task): Cmp {
  if (!S.cmp[t.id]) S.cmp[t.id] = { mode: 'agent', model: t.model, effort: t.effort, access: t.access, pend: {} }
  return S.cmp[t.id]
}
export function scState (t: Task): SideChat {
  if (!S.sideChat[t.id]) S.sideChat[t.id] = { open: false, msgs: [], draft: '', model: t.prov === 'claude' ? 'Sonnet 5.5' : t.model, effort: 'Medium' }
  return S.sideChat[t.id]
}
const stamp = () => '14:4' + (3 + (S.tick % 6))

/* ------------------------------------------------------------------ approvals */
export function resolve (id: string, how: 'ok' | 'deny' | 'snap', quiet = false) {
  const ap = D.approvals[id]; const t = task(ap.task); if (!t || S.resolved[id]) return
  S.resolved[id] = how; S.overlay = null; S.holding = null
  const conv = S.conv[t.id]; const gi = conv.findIndex(x => x.gate === id)
  const entry: ConvItem = { done: id, how, at: stamp() }
  if (gi >= 0) conv.splice(gi + 1, 0, entry); else conv.push(entry)
  t.gate = null; t.status = 'run'; t.now = how === 'deny' ? 'Taking another approach' : 'Continuing'
  const msg = how === 'deny'
    ? (id === 'ap_sql' ? 'Understood. I won\'t touch the invoices. I\'ll compare the report against production by treating settled charges as paid in the query instead.' : id === 'ap_push' ? 'Okay, the branch stays local. Tell me when you want it pushed.' : 'Okay, I\'ll keep the volume and reset the mock with its admin API instead.')
    : how === 'snap' ? 'Snapshot of the 1,284 rows saved in OXESpace (restore it from Checkpoints). Update done: 1,284 rows changed. The report now matches production: R$ 1.284.902,15 for March.'
      : (id === 'ap_sql' ? 'Update done: 1,284 rows changed. The report now matches production: R$ 1.284.902,15 for March.' : id === 'ap_push' ? 'Pushed. I opened <b>pull request #321</b>; checks are running.' : 'Volume removed. Rerunning the webhook tests from an empty database.')
  setTimeout(() => {
    if (!S.resolved[id]) return
    conv.push({ agent: msg, at: stamp() })
    if (id === 'ap_push' && how !== 'deny') {
      t.status = 'review'; t.now = 'Pull request #321 is open'; t.pr = 321
      D.prs[321] = Object.assign({}, D.prs[318], { n: 321, task: 't142', title: 'Make charge creation idempotent', head: t.branch, commits: 6, files: 4, add: 167, del: 12, checks: [['lint', 'pending', '—'], ['typecheck', 'pending', '—'], ['unit (node 22)', 'pending', '—']], reviewers: [['Rafael Moura', 'requested']], body: '' })
    } else { t.now = id === 'ap_sql' ? 'Comparing with production' : id === 'ap_down' ? 'Rerunning the webhook tests' : 'Waiting for your next message' }
    emit()
  }, 2400)
  if (!quiet) {
    toast(how === 'deny' ? `Denied. ${prov(t.prov).name} will try another way.` : how === 'snap' ? 'Snapshot taken, then approved' : `Approved: ${ap.title}`,
      how === 'deny' || ap.irreversible ? {} : { undo: () => { delete S.resolved[id]; t.gate = id; t.status = 'needs'; t.now = 'Waiting for you'; const k = conv.indexOf(entry); if (k >= 0) conv.splice(k, 1); emit() } })
  }
}
export function raisePush () {
  const t = task('t142') as Task
  if (!S.queue.includes('ap_push')) S.queue.push('ap_push')
  delete S.resolved.ap_push
  t.gate = 'ap_push'; t.status = 'needs'; t.now = 'Waiting for you: push the branch'
  if (!S.conv.t142.some(x => x.gate === 'ap_push')) S.conv.t142.push({ gate: 'ap_push' })
}

/* ------------------------------------------------------------------ conversation */
const QUICK_ANSWERS: [RegExp, string][] = [
  [/idempot/i, 'An idempotency key lets a client retry a request safely. The client sends a unique key with the request; the server stores the key with the first response, and any retry with the same key gets that stored response instead of doing the work again.<br><br>Two details matter: store a hash of the request body, so the same key with a different body is rejected (409), and make the check and the write one transaction, so two parallel retries can’t both run.'],
  [/postgres|pg ?1[67]/i, 'For a payments API the main 17 gains are faster vacuum on big tables, better JSON functions and incremental backups. The catch is the upgrade itself: a data directory from 16 needs <code>pg_upgrade</code> or a dump and restore.'],
  [/status update|release/i, 'Here’s a draft:<br><br><b>Release 2026.11.3 moves to Thursday.</b> The idempotency fix for charges needs one more day of testing on staging. Nothing changes for merchants until then; the current version stays live.']
]
function replyFor (text: string, quick = false) {
  if (quick) { const hit = QUICK_ANSWERS.find(([r]) => r.test(text)); return hit ? hit[1] : 'Good question. In short: it depends on your setup, and I can’t see your code from a quick chat. Turn this into a task and I’ll look at the project.' }
  if (/test/i.test(text)) return 'Sure. I\'ll add a case for that and run the suite again before I touch anything else.'
  if (/stop|wait|pause/i.test(text)) return 'Okay, I\'ve paused here. Nothing else will run until you say so.'
  return 'Got it. I\'ll take that into account in the next step and tell you what I changed.'
}
export function sendMsg (t: Task) {
  const text = (S.drafts[t.id] || '').trim(); if (!text) return
  cmpState(t).pend = {}; S.drafts[t.id] = ''
  S.conv[t.id] = S.conv[t.id] || []
  S.conv[t.id].push({ you: text, at: stamp() })
  if (t.status === 'run') { toast(`Queued. ${t.model} reads it after the current step.`); return }
  if (t.status === 'needs' && t.gate && !S.resolved[t.gate]) resolve(t.gate, 'deny', true)
  const back = t.id === 't142' ? 'run' : t.id === 'quick' ? 'done' : 'review'
  t.status = 'run'; t.now = 'Reading your message'; S.running[t.id] = 0
  setTimeout(() => { S.conv[t.id].push({ agent: replyFor(text, t.id === 'quick'), at: stamp() }); t.status = back; t.now = back === 'run' ? 'Running the charges tests' : 'Waiting for your next message'; emit() }, 1600)
}
export function addCheckpoint (t: Task, label: string) {
  const cks = D.checkpoints[t.id] || (D.checkpoints[t.id] = [{ n: 0, at: t.started, label: 'Task started', files: 0 }])
  const n = cks.length
  cks.push({ n, at: stamp(), label, files: t.counts.changes })
  S.conv[t.id].push({ ck: n, at: cks[n].at, label })
  toast(`Checkpoint ${n} made`)
}

/* ------------------------------------------------------------------ simulation: T-142 keeps working, then asks to push */
const T142_STEPS: (() => void)[] = [
  () => { const c = S.conv.t142; const last = c[c.length - 1]; if (last.tools) { last.tools[last.tools.length - 1] = ['run', 'Shell', 'npm test -- charges', '24 passed · 4.2 s'] } },
  () => { S.conv.t142.push({ agent: 'All 24 tests pass, including two parallel retries hitting the same key. Next I\'ll check the 409 path and the 24 h expiry.', at: '14:43' }) },
  () => { S.conv.t142.push({ tools: [['edit', 'Edit', 'test/charges/create.idempotency.test.ts', '+18'], ['run', 'Shell', 'npm test -- charges', '26 passed · 4.4 s'], ['read', 'Read', 'src/jobs/cleanup.ts', '40 lines'], ['edit', 'Edit', 'src/jobs/cleanup.ts', '+6 −0']] }) },
  () => { addCheckpoint(cur().id === 't142' ? cur() : task('t142') as Task, 'All 24 tests pass, including two parallel retries hitting the…'); const t = task('t142') as Task; t.counts.changes = 5 },
  () => {
    S.conv.t142.push({ agent: 'Done: same key and body replays the first response, a reused key with a different body gets 409, and keys expire after 24 h. I want to push the branch and open a pull request.', at: '14:46' })
    raisePush()
    const n = { id: 'n9', kind: 'attn', task: 't142', text: 'Needs you: <b>Push oxe/t142-idempotent-charges</b> · Claude · Make charge creation idempotent', at: '14:46' }
    S.extraNotifs = [n].concat(S.extraNotifs)
    toast('Needs you: Push oxe/t142-idempotent-charges · Claude', { kind: 'attn', go: 'task-push' })
  }
]
export function tick () {
  if (S.paused) return
  S.tick++
  Object.keys(S.running).forEach(k => { const t = task(k); if (t && t.status === 'run') S.running[k] += 2 })
  S.tasks.forEach(t => { if (t.status === 'run' || t.status === 'needs') { if (S.tick % 30 === 0) t.mins++ } })
  const t = task('t142')
  if (t && t.status === 'run' && S.tick % 5 === 0) { const i = S.ckExtra.t142 || 0; if (i < T142_STEPS.length) { T142_STEPS[i](); S.ckExtra.t142 = i + 1 } }
  emit()
}
