/* Overlays on the U1 Dialog contract: size is required; focus goes to the first field, else the safe action;
   the footer is extra (start) · Cancel · primary (end). Esc and the scrim close; focus returns to the trigger. */
import { WORKSPACES } from '../mock/workspaces'
import { wsName, wsList } from '../state/ws'
import { useEffect, useRef, type ReactNode } from 'react'
import { D } from '../mock/data'
import { S, emit, run, cur, task, prov, plural, toast, scState, cmpState, resolve, sendMsg } from '../state/store'
import { Icon, Av, Kbd } from './ui'
import { ImpactBody, ImpactActions } from './Tools'
import { openTask } from './Task'
import { goScreen, SCREENS } from '../screens/registry'
import { railGo } from './Shell'
import { EXTRA_DIALOGS } from './Dialogs'
import { MORE_DIALOGS } from './Catalog'
import { TT_DIALOGS } from './TimeTravel'
import { canSteer } from './Agora'

export interface DialogSpec { size: 'sm' | 'md' | 'lg' | 'xl'; title: ReactNode; icon?: string; body: () => ReactNode; primary?: { label: string; danger?: boolean; act: () => void; disabled?: boolean }; extra?: ReactNode; cancel?: string; safeFirst?: boolean; noFooter?: boolean }

let returnFocus: HTMLElement | null = null
export function rememberFocus () { const a = document.activeElement as HTMLElement | null; if (a && a !== document.body) returnFocus = a }
export function closeOverlay () { S.overlay = null; emit(); const r = returnFocus; returnFocus = null; if (r && document.contains(r)) setTimeout(() => { if (!S.overlay) r.focus() }, 0) } // a quick Esc then Ctrl K must not pull focus out of the new overlay

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

/* ---------------------------------------------------------------- T84 · the command bar
   A front for actions that already exist, with no new powers. "@Agent …" starts or delegates a conversation, as today.
   "/approve" works only here in the window (never over MCP) and opens the same impact preview and hold.
   Every command names its button fallback ("Also: …") and its shortcut; "?" lists them all. */
interface PalItem { g: string; icon: string; label: string; sub?: string; k?: string; also?: string; act: () => void }
export const COMMANDS: [string, string, string, string, string][] = [
  // [command, what it does, button fallback, shortcut, icon]
  ['/approve', 'Review a waiting request: impact preview, then Allow or hold', 'See impact on the request card', 'A', 'shield'],
  ['/deny', 'Deny a waiting request', 'Deny on the request card', 'D', 'shieldx'],
  ['/steer', 'Tell the current agent something; it reads it after the current step', 'The composer', 'Enter', 'send'],
  ['/stop', 'Stop the current agent (asks first)', 'Stop in Agora or the conversation', 'Esc Esc', 'stop'],
  ['/new', 'New conversation', '+ in the project group', 'N', 'plus'],
  ['/history', 'Time travel in this conversation', 'History in the conversation header', 'Ctrl H', 'scrub'],
  ['/agora', 'Every agent, right now', 'Agora in the title bar', 'Ctrl Shift G', 'agora'],
  ['/terminal', 'New terminal where the focused pane is', '+ Terminal in OxeCode', 'Ctrl Shift `', 'term'],
  ['/theme', 'Switch light and dark', 'Settings › Appearance', '', 'sun']
]
const AGENTS: [RegExp, string, string][] = [[/^(claude|cl)\b/i, 'claude', 'Claude Code'], [/^(codex|cx)\b/i, 'codex', 'Codex']]
const pending = () => S.queue.filter(q => !S.resolved[q]).map(q => D.approvals[q])
const fill = (c: string) => () => { const o = S.overlay; if (o) S.overlay = { ...o, query: c + ' ', sel: 0 } }
function cmdItems (raw: string): PalItem[] | null {
  const q = raw.trim()
  if (q === '?') return COMMANDS.map(([c, d, also, k, i]) => ({ g: 'Every command', icon: i, label: c, sub: d, k, also, act: fill(c) }))
  if (q.startsWith('@')) {
    const rest = q.slice(1); const hit = AGENTS.find(([r]) => r.test(rest)); const text = hit ? rest.replace(hit[0], '').trim() : ''
    const opts = hit ? [hit] : AGENTS.filter(([, id, n]) => !rest || n.toLowerCase().startsWith(rest.toLowerCase()) || id.startsWith(rest.toLowerCase()))
    if (!opts.length) return [{ g: 'Agents', icon: 'warn', label: `No agent called "${rest}"`, sub: 'Try @Claude or @Codex', act: () => {} }]
    const c = S.area === 'task' ? cur() : undefined; const items: PalItem[] = []
    opts.forEach(([, id, n]) => {
      items.push({ g: 'Agents', icon: 'plus', label: text ? `New conversation with ${n}: "${text}"` : `New conversation with ${n}…`, sub: 'In its own branch and worktree', also: '+ in the project group', k: 'N',
        act: () => { S.newTask = { project: c?.project || 'api', prov: id, model: id === 'claude' ? 'Opus 5.5' : 'GPT-5 Codex', access: 'edit', worktree: true }; S.overlay = { type: 'newtask', text } } })
      if (c && c.id !== 'quick' && c.prov !== id) items.push({ g: 'Agents', icon: 'layers', label: `Delegate to ${n} from "${c.title}"${text ? `: "${text}"` : ''}`, sub: 'It reports back in this conversation', also: 'Delegated work in OxeCode', act: () => { S.overlay = { type: 'dlg', id: 'delegated' } } })
    })
    return items
  }
  if (q.startsWith('/')) {
    const [cmd, ...restA] = q.split(/\s+/); const rest = restA.join(' ')
    const exact = COMMANDS.find(([c]) => c === cmd.toLowerCase())
    if (!exact) { const known = COMMANDS.filter(([c]) => c.startsWith(cmd.toLowerCase())); return known.length ? known.map(([c, d, also, k, i]) => ({ g: 'Commands', icon: i, label: c, sub: d, k, also, act: fill(c) })) : [{ g: 'Commands', icon: 'warn', label: `No command "${cmd}"`, sub: 'Type ? to see every command', act: () => {} }] }
    const [c, , also, k] = exact; const t = S.area === 'task' ? cur() : undefined
    if (c === '/approve' || c === '/deny') {
      const ps = pending().filter(a => !rest || (a.title + ' ' + task(a.task)!.title).toLowerCase().includes(rest.toLowerCase()))
      if (!ps.length) return [{ g: 'Waiting', icon: 'check', label: 'Nothing waiting', act: () => {} }]
      return ps.map(a => c === '/approve'
        ? { g: 'Review a request · impact preview first', icon: a.irreversible ? 'shieldx' : 'shield', label: a.title, sub: `${task(a.task)!.title}${a.irreversible ? ' · can\'t be undone: you hold to approve' : ''}`, k, also, act: () => { S.overlay = { type: 'approve', id: a.id } } }
        : { g: 'Deny a request', icon: 'shieldx', label: `Deny: ${a.title}`, sub: task(a.task)!.title, k, also, act: () => resolve(a.id, 'deny') })
    }
    if (c === '/steer') return t && t.id !== 'quick' ? [{ g: 'Steer', icon: 'send', label: rest ? `Tell "${t.title}": ${rest}` : `Type what to tell "${t.title}"`, sub: t.status === 'run' ? (canSteer(t) ? 'Read after the current step' : 'Queued until the current turn ends') : 'Sent now', k, also, act: () => { if (rest) { S.drafts[t.id] = rest; sendMsg(t) } else setTimeout(() => document.querySelector<HTMLElement>('.composer textarea')?.focus(), 30) } }] : [{ g: 'Steer', icon: 'info', label: 'Open a conversation first', sub: 'Or steer any agent from Agora', act: () => {} }]
    if (c === '/stop') return t && t.status === 'run' ? [{ g: 'Stop', icon: 'stop', label: `Stop "${t.title}"…`, sub: 'Asks first; the work so far is kept', k, also, act: () => { S.agStop = t.id; S.overlay = { type: 'dlg', id: 'agstop' } } }] : [{ g: 'Stop', icon: 'info', label: 'The current conversation isn\'t running', sub: 'Stop any agent from Agora', act: () => {} }]
    if (c === '/new') return [{ g: 'New', icon: 'plus', label: rest ? `New conversation: "${rest}"` : 'New conversation…', k, also, act: () => { S.overlay = { type: 'newtask', text: rest } } }]
    if (c === '/history') return t && t.id !== 'quick' ? [{ g: 'Time travel', icon: 'scrub', label: `History of "${t.title}"`, k, also, act: () => { S.tt = t.id; S.tab = 'conv' } }] : [{ g: 'Time travel', icon: 'info', label: 'Open a conversation first', act: () => {} }]
    if (c === '/agora') return [{ g: 'Go to', icon: 'agora', label: 'Agora', k, also, act: () => goScreen('agora') }]
    if (c === '/terminal') return [{ g: 'OxeCode', icon: 'term', label: 'New terminal where the focused pane is', k, also, act: () => { railGo('code') } }]
    return [{ g: 'View', icon: 'sun', label: S.mode === 'dark' ? 'Switch to light' : 'Switch to dark', also, act: () => { S.mode = S.mode === 'dark' ? 'light' : 'dark' } }]
  }
  const m = /^(open|go to|go)\s+(.+)$/i.exec(q)
  if (m) {
    const w = m[2].toLowerCase(); const out: PalItem[] = []
    D.connections.filter(c => c.name.toLowerCase().includes(w)).forEach(c => out.push({ g: 'Open', icon: 'm-query', label: `${c.name} in OxeQuery`, sub: `${c.engine} · ${c.env}`, also: 'The connection list in OxeQuery', act: () => { S.q.conn = c.id; railGo('query') } }))
    WORKSPACES.filter(x => x.name.toLowerCase().includes(w) || x.path.toLowerCase().includes(w)).forEach(x => out.push({ g: 'Open', icon: 'm-code', label: `${x.name} in OxeCode`, sub: x.path, also: 'Its card in the OxeCode sidebar', act: () => { S.ws = x.id; railGo('code') } }))
    S.tasks.filter(t => t.id !== 'quick' && t.title.toLowerCase().includes(w)).forEach(t => out.push({ g: 'Open', icon: 'm-chat', label: t.title, sub: 'Conversation', also: 'Its row in the OxeChat sidebar', act: () => openTask(t.id) }))
    D.containers.filter(c => c.name.toLowerCase().includes(w)).forEach(c => out.push({ g: 'Open', icon: 'm-pod', label: `${c.name} in OxePod`, sub: c.image, act: () => { S.pod.sel = c.id; railGo('pod') } }))
    return out.length ? out : [{ g: 'Open', icon: 'info', label: `Nothing called "${m[2]}"`, sub: 'Open finds connections, workspaces, conversations and containers', act: () => {} }]
  }
  return null
}
function palItems (): PalItem[] {
  const it: PalItem[] = [{ g: 'Actions', icon: 'plus', label: 'New conversation', k: 'N', act: () => { S.overlay = { type: 'newtask', text: '' } } }]
  S.queue.filter(q => !S.resolved[q]).forEach(q => it.push({ g: 'Actions', icon: 'shield', label: 'Review: ' + D.approvals[q].title, sub: task(D.approvals[q].task)!.title, act: () => { S.overlay = { type: 'approve', id: q } } }))
  it.push({ g: 'Actions', icon: 'copy', label: 'Open the side chat', k: 'Ctrl .', act: () => { S.overlay = null; const t = cur(); if (t) { scState(t).open = true } } })
  it.push({ g: 'Go to', icon: 'agora', label: 'Agora: every agent, right now', k: 'Ctrl Shift G', act: () => goScreen('agora') })
  S.tasks.filter(t => t.id !== 'quick' && t.id !== S.taskId).forEach(t => it.push({ g: 'Open beside', icon: 'panel', label: `Open beside: ${t.title}`, act: () => { S.area = 'task'; S.cellA = S.taskId; S.split2 = t.id; S.taskId = t.id } }))
  S.tasks.filter(t => t.id !== 'quick').forEach(t => it.push({ g: 'Conversations', icon: 'list', label: t.title, sub: t.model, act: () => openTask(t.id) }))
  D.queries.forEach(q => it.push({ g: 'Made by agents', icon: 'db', label: q.sql.split('\n')[0], sub: `${q.conn} · ${q.at.slice(0, 5)}`, act: () => { if (task(q.task)) S.taskId = q.task; S.q.sel = q.id; S.tab = 'queries'; goScreen('task-current') } }))
  Object.values(D.requests).filter(r => r.task).forEach(r => it.push({ g: 'Made by agents', icon: 'net', label: `${r.method} ${r.name}`, sub: `${task(r.task!)!.key} · ${r.at}`, act: () => { S.taskId = r.task!; S.post.req = r.id; S.tab = 'requests'; goScreen('task-current') } }))
  ;([['code', 'm-code', 'OxeCode'], ['query', 'm-query', 'OxeQuery'], ['pod', 'm-pod', 'OxePod'], ['post', 'm-post', 'OxePost'], ['chat', 'm-chat', 'Quick chat (no project)']] as const).forEach(([v, i, l]) => it.push({ g: 'Modes', icon: i, label: 'Open ' + l, act: () => { S.overlay = null; railGo(v) } }))
  it.push({ g: 'Go to', icon: 'shield', label: 'Approvals', act: () => goScreen('queue') })
  it.push({ g: 'Go to', icon: 'gear', label: 'Settings', k: 'Ctrl ,', act: () => goScreen('settings-general') })
  it.push({ g: 'Go to', icon: 'palette', label: 'Foundations: tokens and components', act: () => goScreen('foundations') })
  it.push({ g: 'View', icon: S.mode === 'dark' ? 'sun' : 'moon', label: S.mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', act: () => { S.mode = S.mode === 'dark' ? 'light' : 'dark' } })
  return it
}
const HINTS: [string, string][] = [['@Codex write tests for the Pix webhook', 'start or delegate'], ['/approve', 'review what is waiting'], ['open billing-staging', 'go anywhere'], ['?', 'every command and its shortcut']]
/** Exact and leading title matches rank first ("find why" opens the conversation, not its request's review). */
function rank (items: PalItem[], q: string): PalItem[] {
  if (!q) return items
  const best = items.filter(i => i.g === 'Conversations' && (i.label.toLowerCase() === q || i.label.toLowerCase().startsWith(q))).map(i => ({ ...i, g: 'Best match' }))
  return best.length ? best.concat(items.filter(i => !(i.g === 'Conversations' && best.some(b => b.label === i.label)))) : items
}
let liveTimer: ReturnType<typeof setTimeout> | null = null
/** The combobox pattern: options only inside the listbox (in labelled groups), none of them tabbable; activedescendant
    and aria-expanded only while there are options; a polite, debounced count. */
function Palette () {
  const o = S.overlay!; const q = (o.query || '').toLowerCase().trim()
  const cmd = cmdItems(o.query || '')
  const items = cmd ?? rank(palItems().filter(i => !q || (i.g + ' ' + i.label + ' ' + (i.sub || '')).toLowerCase().includes(q)), q).slice(0, 40)
  const sel = Math.min(o.sel || 0, Math.max(0, items.length - 1))
  const pick = (i: PalItem) => { S.overlay = null; i.act(); emit() }
  const groups: [string, [PalItem, number][]][] = []
  items.forEach((it, n) => { const g = groups[groups.length - 1]; if (g && g[0] === it.g) g[1].push([it, n]); else groups.push([it.g, [[it, n]]]) })
  const say = items.length ? plural(items.length, 'result') : `No match for "${o.query}"`
  if (liveTimer) clearTimeout(liveTimer)
  liveTimer = setTimeout(() => { const el = document.getElementById('pal-live'); if (el && el.textContent !== say) el.textContent = say }, 300)
  return <div className="ov" onMouseDown={e => { if (e.target === e.currentTarget) closeOverlay() }}>
    <div className="pal" role="dialog" aria-modal="true" aria-label="Command bar">
      <div className="pal-in"><Icon n="search" s={16} /><input autoFocus id="pal-q" value={o.query || ''} placeholder="Ask, run or go to: @agent, /command, open …, or search" aria-label="Command bar" role="combobox" aria-autocomplete="list" aria-expanded={items.length > 0} aria-controls="pal-list" aria-activedescendant={items.length ? 'pal-' + sel : undefined}
        onChange={e => { o.query = e.target.value; o.sel = 0; emit() }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); o.sel = Math.min(items.length - 1, sel + 1); emit() } if (e.key === 'ArrowUp') { e.preventDefault(); o.sel = Math.max(0, sel - 1); emit() } if (e.key === 'Enter' && items[sel]) { e.preventDefault(); pick(items[sel]) } }} /><Kbd>Esc</Kbd></div>
      {!o.query ? <div className="pal-hints" role="group" aria-label="Try">{HINTS.map(([h, d]) => <button key={h} tabIndex={-1} onClick={() => { o.query = h; o.sel = 0; emit(); document.getElementById('pal-q')?.focus() }}><code>{h}</code><span>{d}</span></button>)}</div> : null}
      <div className="pal-list" id="pal-list" role="listbox" aria-label="Results">{groups.map(([g, list], gi) => <div key={g + gi} role="group" aria-labelledby={'palg-' + gi}>
        <div className="pal-g" id={'palg-' + gi} role="presentation">{g}</div>
        {list.map(([i, n]) => <div key={n} id={'pal-' + n} role="option" className="pal-i" aria-selected={n === sel} onMouseEnter={() => { o.sel = n; emit() }} onMouseDown={e => e.preventDefault()} onClick={() => pick(i)}><span className="ico"><Icon n={i.icon} /></span><span className="trunc">{i.label}{i.sub ? <span className="muted">{i.sub}</span> : null}{i.also ? <span className="also">Also: {i.also}</span> : null}</span>{i.k ? <Kbd>{i.k}</Kbd> : <span />}</div>)}</div>)}</div>
      {!items.length ? <div className="state" style={{ padding: 24 }}><p>Nothing matches "{o.query}". Try a word from a title, a table name, or a mode.</p></div> : null}
      <div className="pal-f"><span><Kbd>↑↓</Kbd> move</span><span><Kbd>Enter</Kbd> open</span><span><Kbd>Esc</Kbd> close</span><span><Kbd>@</Kbd> agent <Kbd>/</Kbd> command <Kbd>?</Kbd> all</span><span className="sp" /><span aria-hidden="true">{plural(items.length, 'result')}</span><span id="pal-live" className="sr" role="status" aria-live="polite" /></div></div></div>
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
  removews: () => { const w = WORKSPACES.find(x => x.id === S.wsCtx) || WORKSPACES[0]; return conf('Remove workspace?', <><b>{wsName(w)}</b> leaves the sidebar. The folder on disk is not touched; you can add it again with New workspace.</>, 'Remove workspace', () => { (S.wsGone ||= []).push(w.id); if (S.ws === w.id) S.ws = wsList()[0]?.id || ''; toast(`Removed ${wsName(w)}`, { undo: () => { S.wsGone = S.wsGone!.filter(x => x !== w.id); emit() } }) }, true, 'trash') },
  ...EXTRA_DIALOGS,
  ...TT_DIALOGS,
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
