/* Overlays on the U1 Dialog contract: size is required; focus goes to the first field, else the safe action;
   the footer is extra (start) · Cancel · primary (end). Esc and the scrim close; focus returns to the trigger. */
import { useEffect, useRef, type ReactNode } from 'react'
import { D } from '../mock/data'
import { S, emit, run, cur, task, prov, plural, toast, scState, cmpState } from '../state/store'
import { Icon, Av, Kbd } from './ui'
import { ImpactBody, ImpactActions } from './Tools'
import { openTask } from './Task'
import { goScreen, SCREENS } from '../screens/registry'
import { railGo } from './Shell'
import { EXTRA_DIALOGS } from './Dialogs'
import { MORE_DIALOGS } from './Catalog'

export interface DialogSpec { size: 'sm' | 'md' | 'lg' | 'xl'; title: ReactNode; icon?: string; body: () => ReactNode; primary?: { label: string; danger?: boolean; act: () => void; disabled?: boolean }; extra?: ReactNode; cancel?: string; safeFirst?: boolean; noFooter?: boolean }

let returnFocus: HTMLElement | null = null
export function rememberFocus () { const a = document.activeElement as HTMLElement | null; if (a && a !== document.body) returnFocus = a }
export function closeOverlay () { S.overlay = null; emit(); const r = returnFocus; returnFocus = null; if (r && document.contains(r)) setTimeout(() => r.focus(), 0) }

export function Dialog ({ spec }: { spec: DialogSpec }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const f = (spec.safeFirst ? null : el.querySelector<HTMLElement>('.dlg-b input:not([type=checkbox]):not([type=range]):not([readonly]), .dlg-b textarea, .dlg-b select')) || el.querySelector<HTMLElement>('[data-autofocus]') || el.querySelector<HTMLElement>('.dlg-h button')
    f?.focus()
  }, [spec.title])
  return <div className="ov center" onMouseDown={e => { if (e.target === e.currentTarget) closeOverlay() }}>
    <div className={'dlg ' + spec.size} role="dialog" aria-modal="true" aria-labelledby="dlg-title" ref={ref}
      onKeyDown={e => { const tg = e.target as HTMLElement; if (e.key === 'Enter' && /INPUT|SELECT/.test(tg.tagName) && (tg as HTMLInputElement).type !== 'checkbox' && spec.primary && !spec.primary.disabled) { e.preventDefault(); spec.primary.act(); if (S.overlay) closeOverlay(); else emit(); return } if (e.key === 'Tab') { const f = Array.from(ref.current!.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, select, [tabindex="0"]')); if (!f.length) return; const i = f.indexOf(document.activeElement as HTMLElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus() } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus() } } }}>
      <div className="dlg-h">{spec.icon ? <Icon n={spec.icon} s={16} /> : null}<h2 id="dlg-title">{spec.title}</h2><button className="ibtn" onClick={closeOverlay} aria-label="Close" title="Close (Esc)"><Icon n="x" /></button></div>
      <div className="dlg-b">{spec.body()}</div>
      {spec.noFooter ? null : <div className="dlg-f">{spec.extra}<span className="sp" />
        <button className="btn" onClick={closeOverlay} data-autofocus>{spec.cancel || (spec.primary ? 'Cancel' : 'Close')}</button>
        {spec.primary ? <button className={'btn ' + (spec.primary.danger ? 'dng' : 'pri')} disabled={spec.primary.disabled} onClick={() => { spec.primary!.act(); if (S.overlay) closeOverlay(); else emit() }}>{spec.primary.label}</button> : null}</div>}
    </div></div>
}

/* ---------------------------------------------------------------- approval with impact */
function ApproveDialog ({ id }: { id: string }) {
  const ap = D.approvals[id]; const t = task(ap.task)!
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus() }, [id])
  return <div className="ov center" onMouseDown={e => { if (e.target === e.currentTarget) closeOverlay() }}>
    <div className="dlg lg" role="dialog" aria-modal="true" aria-labelledby="ap-title" ref={ref}>
      <div className="dlg-h"><span className="sun live" /><h2 id="ap-title">{prov(t.prov).name} asks to {ap.verb.charAt(0).toLowerCase() + ap.verb.slice(1)}</h2><span className={'pill ' + (ap.irreversible ? 'irrev' : 'rev')}>{ap.irreversible ? 'Can\'t be undone' : 'Can be undone'}</span><button className="ibtn" onClick={closeOverlay} aria-label="Close" title="Close (Esc). The request keeps waiting."><Icon n="x" /></button></div>
      <div className="dlg-b"><ImpactBody ap={ap} /></div>
      <div className="dlg-f"><ImpactActions ap={ap} /></div></div></div>
}

/* ---------------------------------------------------------------- new task (lite B: a new conversation) */
function NewTask () {
  const o = S.overlay!; const nt = (S.newTask ||= { project: 'api', prov: 'claude', model: 'Opus 5.5', access: 'edit', worktree: true })
  const text = o.text || ''
  return <Dialog spec={{ size: 'md', title: 'New conversation', icon: 'plus', body: () => <>
    <div className="field"><label htmlFor="nt-text">What should the agent do?</label><textarea className="input" id="nt-text" rows={4} value={text} placeholder="Describe the outcome you want, e.g. Add CSV export to the statements page" onChange={e => { o.text = e.target.value; emit() }} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && text.trim()) { e.preventDefault(); startTask(text); emit() } }} /></div>
    <div className="row" style={{ alignItems: 'start' }}><div className="field" style={{ flex: 1 }}><label htmlFor="nt-proj">Project</label><select className="sel" id="nt-proj" value={nt.project} onChange={e => { nt.project = e.target.value; emit() }}>{Object.values(D.projects).filter(p => !S.freshWs || p.id === 'api').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div className="field" style={{ flex: 1 }}><label htmlFor="nt-agent">Agent and model</label><select className="sel" id="nt-agent" value={nt.prov + '|' + nt.model} onChange={e => { const [p, m] = e.target.value.split('|'); nt.prov = p; nt.model = m; emit() }}>{Object.values(D.providers).flatMap(p => p.models.map(m => { const off = S.freshWs && p.id === 'codex'; return <option key={p.id + m} value={p.id + '|' + m} disabled={off}>{p.name} · {m}{off ? ' (not installed)' : ''}</option> }))}</select></div></div>
    <div className="field"><label>What it may do</label><div className="chips">{([['read', 'Read only', 'eye'], ['edit', 'Can edit', 'pencil'], ['full', 'Full access', 'shieldx']] as const).map(([k, l, i]) => <button key={k} className={'chip' + (k === 'full' ? ' dz' : '')} aria-pressed={nt.access === k} onClick={run(() => { nt.access = k })}><Icon n={i} s={12} />{l}</button>)}</div>
      {nt.access === 'full' ? <div className="callout danger"><Icon n="warn" /><span>Full access runs commands, writes to databases and calls networks without asking. Use it only in a throwaway environment.</span></div> : null}</div>
    <label className="row" style={{ fontSize: 13 }}><input type="checkbox" checked={nt.worktree} onChange={e => { nt.worktree = e.target.checked; emit() }} /> Work in its own branch and worktree <span className="muted">· oxe/t146-…</span></label></>,
    extra: <span className="muted" style={{ fontSize: 12 }}><Kbd>Ctrl Enter</Kbd> to start</span>,
    primary: { label: 'Start', disabled: !text.trim(), act: () => startTask(text) } }} />
}
export function startTask (text: string) {
  const nt = S.newTask!; const id = 't146'; const n = S.tasks.filter(t => t.id.startsWith('t146')).length
  const tid = n ? id + '_' + n : id
  const title = text.trim().replace(/\.$/, '').slice(0, 80)
  S.tasks.unshift({ id: tid, key: 'T-' + (146 + n), title, project: nt.project, prov: nt.prov as 'claude', model: nt.model, effort: nt.prov === 'claude' ? 'High' : 'Medium', access: nt.access as 'edit', status: 'run', branch: 'oxe/t' + (146 + n) + '-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24).replace(/-$/, ''), worktree: nt.worktree, started: '14:44', mins: 0, cost: 0, ctx: [2, '4k', '200k'], counts: { terminal: 0, queries: 0, requests: 0, containers: 0, changes: 0, pr: 0 }, now: 'Reading the project' })
  S.conv[tid] = [{ you: text.trim(), at: '14:44' }, { tools: [['read', 'Read', 'README.md', '88 lines'], ['read', 'Search', 'project files', '214 files', undefined, true]] }]
  S.running[tid] = 0; S.taskId = tid; S.tab = 'conv'; S.area = 'task'; S.emptyWs = false; S.overlay = null
  toast(`Started with ${prov(nt.prov).name}${nt.worktree ? ' in its own worktree' : ''}`)
  setTimeout(() => document.querySelector<HTMLElement>('.th h1')?.focus(), 50)
  setTimeout(() => { const t = task(tid); if (!t) return; const c = S.conv[tid]; c[1].tools![1] = ['read', 'Search', 'project files', '214 files']; c.push({ agent: 'I read the project. Here\'s my plan before I change anything:<ol><li>Find where this lives today</li><li>Make the change with tests</li><li>Run the suite and show you the diff</li></ol>Say <b>go</b>, or tell me what to change.', at: '14:45' }); t.status = 'review'; t.now = 'Waiting for your go'; emit() }, 2600)
}

/* ---------------------------------------------------------------- command palette */
interface PalItem { g: string; icon: string; label: string; sub?: string; k?: string; act: () => void }
function palItems (): PalItem[] {
  const it: PalItem[] = [{ g: 'Actions', icon: 'plus', label: 'New conversation', k: 'N', act: () => { S.overlay = { type: 'newtask', text: '' } } }]
  S.queue.filter(q => !S.resolved[q]).forEach(q => it.push({ g: 'Actions', icon: 'shield', label: 'Review: ' + D.approvals[q].title, sub: task(D.approvals[q].task)!.title, act: () => { S.overlay = { type: 'approve', id: q } } }))
  it.push({ g: 'Actions', icon: 'copy', label: 'Open the side chat', k: 'Ctrl .', act: () => { S.overlay = null; const t = cur(); if (t) { scState(t).open = true } } })
  S.tasks.filter(t => t.id !== 'quick' && t.id !== S.taskId).forEach(t => it.push({ g: 'Open beside', icon: 'panel', label: `Open beside: ${t.title}`, act: () => { S.area = 'task'; S.cellA = S.taskId; S.split2 = t.id; S.taskId = t.id } }))
  S.tasks.filter(t => t.id !== 'quick').forEach(t => it.push({ g: 'Conversations', icon: 'list', label: t.title, sub: t.model, act: () => openTask(t.id) }))
  D.queries.forEach(q => it.push({ g: 'Made by agents', icon: 'db', label: q.sql.split('\n')[0], sub: `${q.conn} · ${q.at.slice(0, 5)}`, act: () => { if (task(q.task)) S.taskId = q.task; S.q.sel = q.id; S.tab = 'queries'; goScreen('task-current') } }))
  Object.values(D.requests).filter(r => r.task).forEach(r => it.push({ g: 'Made by agents', icon: 'net', label: `${r.method} ${r.name}`, sub: `${task(r.task!)!.key} · ${r.at}`, act: () => { S.taskId = r.task!; S.post.req = r.id; S.tab = 'requests'; goScreen('task-current') } }))
  ;([['code', 'term', 'OxeCode'], ['query', 'db', 'OxeQuery'], ['post', 'net', 'OxePost'], ['pod', 'box', 'OxePod'], ['chat', 'chat', 'Quick chat (no project)']] as const).forEach(([v, i, l]) => it.push({ g: 'Modes', icon: i, label: 'Open ' + l, act: () => { S.overlay = null; railGo(v) } }))
  it.push({ g: 'Go to', icon: 'shield', label: 'Approvals', act: () => goScreen('queue') })
  it.push({ g: 'Go to', icon: 'gear', label: 'Settings', k: 'Ctrl ,', act: () => goScreen('settings-general') })
  it.push({ g: 'Go to', icon: 'palette', label: 'Foundations: tokens and components', act: () => goScreen('foundations') })
  it.push({ g: 'View', icon: S.mode === 'dark' ? 'sun' : 'moon', label: S.mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', act: () => { S.mode = S.mode === 'dark' ? 'light' : 'dark' } })
  return it
}
function Palette () {
  const o = S.overlay!; const q = (o.query || '').toLowerCase()
  const items = palItems().filter(i => !q || (i.g + ' ' + i.label + ' ' + (i.sub || '')).toLowerCase().includes(q)).slice(0, 40)
  const sel = Math.min(o.sel || 0, Math.max(0, items.length - 1))
  const pick = (i: PalItem) => { S.overlay = null; i.act(); emit() }
  let lastG = ''
  return <div className="ov" onMouseDown={e => { if (e.target === e.currentTarget) closeOverlay() }}>
    <div className="pal" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="pal-in"><Icon n="search" s={16} /><input autoFocus id="pal-q" value={o.query || ''} placeholder="Search tasks, queries, requests, or type a command" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={'pal-' + sel}
        onChange={e => { o.query = e.target.value; o.sel = 0; emit() }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); o.sel = Math.min(items.length - 1, sel + 1); emit() } if (e.key === 'ArrowUp') { e.preventDefault(); o.sel = Math.max(0, sel - 1); emit() } if (e.key === 'Enter' && items[sel]) { e.preventDefault(); pick(items[sel]) } }} /><Kbd>Esc</Kbd></div>
      <div className="pal-list" id="pal-list" role="listbox">{items.length ? items.map((i, n) => { const head = i.g !== lastG ? (lastG = i.g, <div className="pal-g" key={'g' + n}>{i.g}</div>) : null
        return [head, <button key={n} id={'pal-' + n} role="option" className="pal-i" aria-selected={n === sel} onMouseEnter={() => { o.sel = n; emit() }} onClick={() => pick(i)}><span className="ico"><Icon n={i.icon} /></span><span className="trunc">{i.label}{i.sub ? <span className="muted">{i.sub}</span> : null}</span>{i.k ? <Kbd>{i.k}</Kbd> : <span />}</button>] })
        : <div className="state" style={{ padding: 24 }}><p>Nothing matches "{o.query}". Try a word from a title, a table name, or a mode.</p></div>}</div>
      <div className="pal-f"><span><Kbd>↑↓</Kbd> move</span><span><Kbd>Enter</Kbd> open</span><span><Kbd>Esc</Kbd> close</span><span className="sp" /><span>{plural(items.length, 'result')}</span></div></div></div>
}

/* ---------------------------------------------------------------- stage-1 dialogs */
const conf = (title: string, text: ReactNode, label: string, act: () => void, danger = true, icon = 'warn'): DialogSpec => ({ size: 'sm', icon, title, body: () => <p style={{ color: 'var(--text-secondary)' }}>{text}</p>, safeFirst: true, primary: { label, danger, act } })
export const DIALOGS: Record<string, () => DialogSpec> = {
  rename: () => { const t = cur(); return { size: 'sm', title: 'Rename task', icon: 'pencil', body: () => <div className="field"><label htmlFor="rn">Name</label><input className="input" id="rn" defaultValue={t.title} onChange={e => { S.renameTo = e.target.value }} /></div>, primary: { label: 'Rename', act: () => { if (S.renameTo?.trim()) { t.title = S.renameTo.trim(); toast('Renamed') } } } } },
  deletetask: () => { const t = cur(); return conf(`Delete "${t.title}"?`, <>The conversation, its checkpoints and its side chat are deleted. The branch <span className="mono">{t.branch}</span> and its commits stay in git. This can't be undone.</>, 'Delete task', () => { S.tasks = S.tasks.filter(x => x !== t); S.taskId = S.tasks[0].id; toast(`Deleted ${t.key}`) }, true, 'trash') },
  restore: () => { const t = cur(); const ck = S.overlay!.ck as number; const c = (D.checkpoints[t.id] || [])[ck]; return { size: 'md', icon: 'undo', title: `Restore files to checkpoint ${ck}?`, body: () => <><p style={{ color: 'var(--text-secondary)' }}>The worktree goes back to "{c?.label}" ({c?.at}). The conversation stays as it is.</p>
    <div className="callout ok"><Icon n="history" /><span>A checkpoint of the current files is made first, so you can come back.</span></div><div className="callout warn"><Icon n="warn" /><span>Only files go back. Queries, requests and container changes already happened and stay.</span></div></>, primary: { label: 'Restore files', act: () => { delete S.past[t.id]; toast(`Files restored to checkpoint ${ck}`, { undo: () => { toast('Back to the files you had') } }) } } } },
  branch: () => { const t = cur(); const ck = S.overlay!.ck; return { size: 'md', icon: 'fork', title: ck === 'message' ? 'Branch from this message' : `Branch from checkpoint ${ck}`, body: () => <><p style={{ color: 'var(--text-secondary)' }}>A new task starts with the conversation up to that point and a new worktree from the same files. {t.key} keeps running untouched.</p>
    <div className="field"><label htmlFor="br-n">New task name</label><input className="input" id="br-n" defaultValue={t.title + ' (try 2)'} /></div>{t.prov === 'codex' ? <div className="callout info"><Icon n="info" /><span>Codex can't fork a session, so the conversation is replayed into a new one. It takes about 20 s.</span></div> : null}</>, primary: { label: 'Create branch', act: () => toast(`Branched ${t.key}. The new task appears under Running.`) } } },
  fullaccess: () => conf('Give full access?', <>{prov(cur().prov).name} will run commands, write to databases and call any network without asking you, until you change it back. Use it only in a throwaway environment.</>, 'Give full access', () => { const c = cmpState(cur()); c.access = 'full'; c.pend.access = true }, true, 'shieldx'),
  scdiscard: () => ({ size: 'sm', icon: 'trash', title: 'Discard the side chat?', body: () => <p style={{ color: 'var(--text-secondary)' }}>Its answers will be gone. The conversation isn't affected.</p>, cancel: 'Keep', safeFirst: true, primary: { label: 'Discard', danger: true, act: () => { const s = scState(cur()); s.open = false; s.msgs = [] } } }),
  discard: () => conf('Discard all changes?', <>Every change in <span className="mono">{cur().branch}</span> that isn't committed is thrown away. The checkpoints stay, so you can restore one later.</>, 'Discard changes', () => toast('Changes discarded'), true, 'trash'),
  removews: () => conf(`Remove ${D.company.name}?`, 'The workspace leaves OXESpace. Your project folders, git history and agent accounts are not touched. Its tasks and settings are deleted.', 'Remove workspace', () => toast('Removing a workspace is simulated here.'), true, 'trash'),
  ...EXTRA_DIALOGS,
  ...MORE_DIALOGS
}

export function OverlayLayer () {
  const o = S.overlay; if (!o) return null
  if (o.type === 'approve' && o.id) return <ApproveDialog id={o.id} />
  if (o.type === 'pal') return <Palette />
  if (o.type === 'newtask') return <NewTask />
  const spec = o.id && DIALOGS[o.id]; if (!spec) return null
  return <Dialog spec={spec()} />
}
export { SCREENS, Av }
