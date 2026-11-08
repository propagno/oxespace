/* The playground chrome (screen picker, frame size, theme, state) around one scaled app frame. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { D } from './mock/data'
import { S, emit, run, useStore, tick, setAppEl, cur, H, toast, resolve } from './state/store'
import { SCREENS, goScreen, syncScreen, resetAll } from './screens/registry'
import { TitleBar, StatusBar, Rail, Notifications, MenuLayer, Toasts, railGo } from './components/Shell'
import { Sidebar, EmptyHome, ChatArea } from './components/Task'
import { goMode, MODES } from './components/Shell'
import { codeMaxToggle, split } from './components/Modes'
import { QueueView, startHold, cancelHold, refocus } from './components/Tools'
import { OverlayLayer, closeOverlay, rememberFocus } from './components/Overlays'
import { Icon, StateBlock } from './components/ui'
import { Later } from './components/Later'
import { CodeMode } from './components/Modes'
import { decideCmd } from './components/Thread'
import { QueryMode } from './components/Modes2'
import { OsToast } from './components/Cockpit'
import { SettingsView } from './components/Settings'
import { Foundations } from './components/Foundations'
import { DialogGallery } from './components/Catalog'
import { Agora, agoraKey } from './components/Agora'
import { PhoneStage } from './components/Phone'

const GROUPS = Array.from(new Set(SCREENS.map(s => s.group)))
const tagLabel = (s: { tag: string }) => s.tag === 'later' ? 'later' : '1.5.0'
const tagClass = (s: { tag: string }) => s.tag === 'later' ? 'later' : 'now'

function FirstRun () {
  const fr = S.fr; const ready = fr.claude === 'ready' || fr.codex === 'ready'
  const step = (n: number, done: boolean, on: boolean, title: string, text: React.ReactNode, act?: React.ReactNode) => <div className={'fr-step' + (done ? ' done' : on ? '' : ' later')}><span className="n">{done ? <Icon n="check" s={12} /> : n}</span><div><b style={{ font: '600 15px var(--f-display)' }}>{title}</b><div className="muted" style={{ fontSize: 12 }}>{text}</div></div>{act}</div>
  return <div className="fr"><div className="fr-in">
    <div className="stack" style={{ gap: 10 }}><h1 tabIndex={-1} id="fr-h">Agents that work in your code, and show you every step</h1><p className="lead">Three steps. Nothing is uploaded; your code stays on this computer.</p></div>
    {step(1, !!fr.folder, !fr.folder, 'Open a project folder', fr.folder ? <span className="mono">~/code/cajui/cajui-api · git, branch main</span> : 'A git repository on this computer.', fr.folder ? null : <button className="btn pri" onClick={run(() => { fr.folder = true; setTimeout(() => document.getElementById('fr-h')?.focus(), 0); toast('Opened ~/code/cajui/cajui-api') })}><Icon n="folder" s={12} />Choose folder…</button>)}
    {step(2, ready, !!fr.folder && !ready, 'Connect an agent', <div className="agents-chk">
      <div><span className="pdot claude" /><b>Claude Code</b>{fr.claude === 'ready' ? <span className="res ok">Ready · Opus 5.5</span> : fr.claude === 'checking' ? <><span className="muted">Waiting for sign-in in your browser…</span><button className="btn sm ghost" onClick={run(() => { fr.claude = 'found' })}>Cancel</button><button className="btn sm" onClick={run(() => { fr.claude = 'ready'; setTimeout(() => document.getElementById('fr-h')?.focus(), 0) })}>Simulate: signed in</button></> : <><span className="muted">Found 2.4.1 on PATH · not signed in</span><button className="btn sm" disabled={!fr.folder} onClick={run(() => { fr.claude = 'checking'; toast('Opened the Claude sign-in page in your browser') })}>Sign in</button></>}</div>
      <div><span className="pdot codex" /><b>Codex</b><span className="muted">Not found on PATH</span><button className="btn sm ghost" onClick={run(() => toast('Install with npm install -g @openai/codex, then come back here'))}>How to install</button></div></div>)}
    {step(3, false, ready, 'Start your first conversation', ready ? 'Describe what you want done; the agent works in its own branch.' : 'Available once an agent is ready.', <button className="btn pri" disabled={!ready} title={ready ? undefined : 'Connect an agent first'} onClick={run(() => { S.freshWs = true; S.tasks = S.tasks.filter(x => x.id === 'quick'); S.queue = []; S.extraNotifs = []; D.notifications.forEach(n => { S.notifRead[n.id] = true }); S.area = 'task'; S.emptyWs = true; S.overlay = { type: 'newtask', text: '' } })}><Icon n="plus" s={12} />New conversation</button>)}
    <div className="stack"><div className="slabel">Or open a mode on its own</div><div className="tiles">
      {([['code', 'term', 'k-shell', 'OxeCode', 'Terminals and agent CLIs in panes'], ['query', 'db', 'k-db', 'OxeQuery', 'Postgres, MySQL, SQLite, ClickHouse']] as const).map(([v, i, k, n, d]) => <button key={v} className={'tile ' + k} onClick={() => railGo(v)}><b><Icon n={i} />{n}</b>{d}</button>)}</div></div></div></div>
}
function NextPush () {
  const s = SCREENS.find(x => x.id === S.screen)
  return <StateBlock kind="empty" icon="layers" title={`${s ? s.name : 'This screen'} isn't in the playground`} text="Pick another screen from the list on the right.">
    <button className="btn pri" onClick={() => goScreen('task-approval')}>Back to the task view</button></StateBlock>
}
function Body () {
  const a = S.area
  const wb = (main: React.ReactNode, side = false) => <div className={'wb' + (side ? (S.sbCol ? ' sb-col' : '') : ' sb-none')}>{side ? <Sidebar /> : null}<main className="main">{main}</main></div>
  if (a === 'firstrun') return wb(<FirstRun />)
  if (a === 'agora') return wb(<Agora />)
  if (a === 'task') return wb(S.emptyWs ? <EmptyHome /> : S.view === 'empty' ? <EmptyHome /> : <ChatArea />, true)
  if (a === 'later-multi' || a === 'later-watch') return wb(<Later />, true)
  if (a === 'queue') return wb(S.view === 'loading' ? <StateBlock kind="loading" /> : <QueueView />)
  if (a === 'mode' && S.mode2 === 'code') return wb(<CodeMode />)
  if (a === 'mode' && S.mode2 === 'query') return wb(<QueryMode />)
  if (a === 'settings') return wb(<SettingsView />)
  if (a === 'found') return wb(<Foundations />)
  if (a === 'dialogs') return wb(<DialogGallery />)
  return wb(<NextPush />)
}

function App () {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { setAppEl(ref.current) })
  return <div ref={ref} className={'app' + (S.w === 900 ? ' w900' : '')} data-mode={S.mode} style={{ width: S.w, height: H(), transform: `scale(${S.scale})` }}
    onClick={() => { if (S.menu || S.notif) { S.menu = null; S.notif = false; emit() } }}>
    <TitleBar /><Body /><StatusBar /><Notifications /><OverlayLayer /><MenuLayer /><Toasts /><OsToast /></div>
}

function Side () {
  const s = SCREENS.find(x => x.id === S.screen) || SCREENS[2]
  return <aside className="pg-side" aria-label="About this screen">
    <div><div className="pg-kick"><span className={'pg-tag ' + tagClass(s)}>{tagLabel(s)}</span><span>{s.group}</span></div><h2>{s.name}</h2></div>
    {s.desc ? <p>{s.desc}</p> : null}
    {s.plan.length ? <div><h3 className="side-h">Plan items</h3><div className="pg-plan">{s.plan.map(p => <span key={p}>{p}</span>)}</div></div> : null}
    {s.tries.length ? <div><h3 className="side-h">Try it</h3><ul className="pg-try">{s.tries.map(t => <li key={t}>{t}</li>)}</ul></div> : null}
    <div><h3 className="side-h">Keyboard</h3><div className="keys"><kbd>Ctrl K</kbd><span>Command palette</span><kbd>N</kbd><span>New task</span><kbd>Ctrl B</kbd><span>Collapse the task list</span><kbd>D</kbd><span>Deny (the default)</span><kbd>A</kbd><span>Approve; hold when irreversible</span><kbd>J K</kbd><span>Move in the approval queue</span><kbd>L</kbd><span>Back to now from a checkpoint</span><kbd>Esc</kbd><span>Close</span></div></div>
    <div className="idx"><h3 className="side-h">All screens <small>{SCREENS.length}</small></h3>{GROUPS.map(g => <div key={g}><h4>{g}</h4><ul>{SCREENS.filter(x => x.group === g).map(x => <li key={x.id}><button aria-current={x.id === S.screen} onClick={() => goScreen(x.id)}><span>{x.name}</span><span className={'pg-tag ' + tagClass(x)}>{tagLabel(x)}</span></button></li>)}</ul></div>)}</div>
    <details><summary className="side-h">What changes in Mandacaru 1.5</summary><table className="toks"><tbody>{D.tokenChanges.map(t => <tr key={t.tok}><td>{t.sw.map(c => <span key={c} className="sw" style={{ background: c }} />)}{t.tok}</td><td>{t.what}</td></tr>)}</tbody></table></details>
    <p className="pg-note">1.5.0, the cockpit: see, control, audit and recover what agents do. It opens on Agora. OxePost and OxePod are panels now; mature tools are integrated, not rebuilt. Mock data for a fictional company; nothing talks to a model, a database or the network.</p></aside>
}

function useKeys () {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)
      const ap = S.overlay?.type === 'approve' ? S.overlay.id : S.area === 'queue' && !S.overlay ? S.queue.filter(q => !S.resolved[q])[Math.min(S.queueSel, S.queue.filter(q => !S.resolved[q]).length - 1)] : null
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); rememberFocus(); S.overlay = { type: 'pal', query: '', sel: 0 }; emit(); return }
      if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); S.sbCol = !S.sbCol; syncScreen(); emit(); return }
      if (mod && e.key === ',') { e.preventDefault(); goScreen('settings-general'); return }
      if (mod && !e.shiftKey && !e.altKey && /^[1-3]$/.test(e.key)) { e.preventDefault(); goMode(MODES[+e.key - 1][0]); return }
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); rememberFocus(); S.overlay = { type: 'newtask', text: '' }; emit(); return }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); goScreen('queue'); return }
      if (mod && e.shiftKey && (e.key === '|' || e.key === '\\' || e.key === '_' || e.key === '-') && S.area === 'mode' && S.mode2 === 'code') { e.preventDefault(); split(e.key === '_' || e.key === '-'); emit(); return }
      if (mod && e.shiftKey && e.key === 'Enter' && S.area === 'mode' && S.mode2 === 'code') { e.preventDefault(); codeMaxToggle(); emit(); return }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'h' && S.area === 'task') { e.preventDefault(); const t = cur(); if (t && t.id !== 'quick') { S.tt = S.tt === t.id ? undefined : t.id; S.ttAt = undefined; S.tab = 'conv'; emit() } return }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); goScreen('agora'); return } // Ctrl+0 stays the terminal's font reset (1.4)
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); if (S.area === 'mode' && S.mode2 === 'code') S.codeDock = S.codeDock === 'files' ? undefined : 'files'; else if (S.area === 'task') { const t = cur(); S.dockTool[t.id] = 'files'; const o = S.dockOpen[t.id] || []; if (!o.includes('files')) S.dockOpen[t.id] = o.concat('files') } emit(); return }
      if (e.key === 'Escape') { if (S.menu || S.notif) { S.menu = null; S.notif = false; emit() } else if (S.overlay) closeOverlay(); return }
      if (typing || mod || e.altKey) return
      const k = e.key.toLowerCase()
      if (ap && !e.repeat) {
        if (k === 'd') { resolve(ap, 'deny'); emit(); refocus(); return }
        if (k === 'a') { if (D.approvals[ap].irreversible) startHold(ap); else { resolve(ap, 'ok'); emit() } return }
      }
      if (S.overlay) return
      if (S.area === 'agora' && ['d', 'a', 'j', 'k', 'arrowdown', 'arrowup'].includes(k) && !e.repeat && agoraKey(k)) { e.preventDefault(); return }
      if (S.area === 'task' && cur()?.ask === 'cmd' && (k === 'd' || k === 'a')) { decideCmd(cur(), k === 'd' ? 'deny' : 'once'); emit(); return }
      if (S.area === 'queue' && (k === 'j' || k === 'k')) { const n = S.queue.filter(q => !S.resolved[q]).length; S.queueSel = Math.max(0, Math.min(n - 1, S.queueSel + (k === 'j' ? 1 : -1))); emit(); return }
      if (e.key === '?') { S.overlay = { type: 'dlg', id: 'shortcuts' }; emit(); return }
      if (k === 'n') { e.preventDefault(); rememberFocus(); S.overlay = { type: 'newtask', text: '' }; emit(); return }
      if (k === 'l' && S.area === 'task' && S.past[S.taskId] != null) { delete S.past[S.taskId]; emit() }
    }
    const up = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'a') cancelHold() }
    const click = (e: MouseEvent) => { const b = (e.target as HTMLElement).closest('button'); if (b && !S.overlay) rememberFocus() }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('click', click, true)
    const iv = setInterval(tick, 2000)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('click', click, true); clearInterval(iv) }
  }, [])
}

export function Playground () {
  useStore(); useKeys()
  const stage = useRef<HTMLElement>(null)
  const [, setSz] = useState(0)
  useLayoutEffect(() => {
    const el = stage.current!; const fit = () => { const sc = Math.max(0.2, Math.min(1, (el.clientWidth - 32) / S.w, (el.clientHeight - 44) / H())); if (Math.abs(sc - S.scale) > 0.001) { S.scale = sc; emit() } setSz(x => x + 1) }
    const ro = new ResizeObserver(fit); ro.observe(el); fit(); return () => ro.disconnect()
  }, [S.w])
  useEffect(() => {
    const h = location.hash.slice(1); goScreen(SCREENS.some(s => s.id === h) ? h : 'agora')
    const onHash = () => { const id = location.hash.slice(1); if (id !== S.screen && SCREENS.some(s => s.id === id)) goScreen(id) }
    window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const idx = SCREENS.findIndex(s => s.id === S.screen)
  const seg = <T extends string | number>(label: string, k: 'w' | 'mode' | 'view', opts: [T, string][]) => <div className="pg-group"><label>{label}</label><div className="seg" role="group" aria-label={label}>{opts.map(([v, l]) => <button key={String(v)} aria-pressed={S[k] === v} onClick={run(() => { (S as unknown as Record<string, unknown>)[k] = v })}>{l}</button>)}</div></div>
  return <div className="pg">
    <header className="pg-bar"><div className="pg-brand"><b>OXESpace 1.5.0</b><span>Direction B playground</span></div>
      <div className="pg-screen"><button className="pg-ib" aria-label="Previous screen" onClick={() => goScreen(SCREENS[(idx - 1 + SCREENS.length) % SCREENS.length].id)}>‹</button>
        <select aria-label="Screen" value={S.screen} onChange={e => goScreen(e.target.value)}>{GROUPS.map(g => <optgroup key={g} label={g}>{SCREENS.filter(s => s.group === g).map(s => <option key={s.id} value={s.id}>{s.name} · {tagLabel(s)}</option>)}</optgroup>)}{SCREENS.some(s => s.id === S.screen) ? null : <option value={S.screen}>{S.screen}</option>}</select>
        <button className="pg-ib" aria-label="Next screen" onClick={() => goScreen(SCREENS[(idx + 1) % SCREENS.length].id)}>›</button></div>
      {seg('Frame', 'w', [[1440, '1440 × 900'], [900, '900 × 620']])}{seg('Theme', 'mode', [['light', 'Light'], ['dark', 'Dark']])}{seg('State', 'view', [['live', 'Live'], ['loading', 'Loading'], ['empty', 'Empty'], ['error', 'Error']])}
      <div className="pg-group"><div className="seg"><button aria-pressed={S.paused} onClick={run(() => { S.paused = !S.paused })}>{S.paused ? 'Resume' : 'Pause'}</button><button onClick={resetAll}>Reset</button></div></div></header>
    <main className="pg-main"><section className="stage" ref={stage} aria-label="App preview">{S.area === 'phone' ? <PhoneStage /> : null}<div className="frame-wrap" hidden={S.area === 'phone'} style={{ width: S.w * S.scale, height: H() * S.scale }}><App /><div className="frame-cap">{S.w} × {H()} · {S.mode} · shown at {Math.round(S.scale * 100)}%</div></div></section><Side /></main></div>
}
