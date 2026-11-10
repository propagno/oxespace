/* App chrome: title bar, mode rail, status bar, notifications, menus and toasts. */
import type { ReactNode } from 'react'
import { D } from '../mock/data'
import { S, emit, run, task, money, plural, needsN, H, type Mode2 } from '../state/store'
import { Icon, Logo, Kbd, MI, menuBtn, Html } from './ui'
import { goScreen, syncScreen } from '../screens/registry'
import { wsFor, TASK_WT } from '../mock/workspaces'
import { curWs, wsName, wsColor } from '../state/ws'

export const MENUS: Record<string, () => ReactNode> = {}

/** Three modes in 1.5.0 (OxePost and OxePod became panels: Containers and HTTP calls). */
export const MODES: [string, string, string][] = [['code', 'OxeCode', 'Ctrl 1'], ['chat', 'OxeChat', 'Ctrl 2'], ['query', 'OxeQuery', 'Ctrl 3']]
export function modeOf () { return S.area === 'task' || S.area === 'later-multi' || S.area === 'later-watch' ? 'chat' : S.area === 'mode' ? S.mode2 : '' }
export function goMode (m: string) { railGo(m === 'chat' ? 'tasks' : m) }
const MENUBAR: [string, string][] = [['m_file', 'File'], ['m_edit', 'Edit'], ['m_view', 'View'], ['m_tools', 'Tools'], ['m_help', 'Help']]
export function TitleBar () {
  const n = needsN(); const cur = modeOf()
  const unread = S.area === 'firstrun' ? 0 : D.notifications.filter(x => !S.notifRead[x.id]).length + S.extraNotifs.length
  return <header className="tb tb2">
    <div className="tb-l"><Logo /><nav className="menubar" aria-label="Menu">{MENUBAR.map(([id, l]) => <button key={id} onClick={menuBtn(id)} aria-haspopup="menu" aria-expanded={S.menu?.id === id}>{l}</button>)}</nav></div>
    <nav className="modes" aria-label="Modes">{MODES.map(([id, l, k]) => <button key={id} aria-current={cur === id ? 'page' : undefined} title={`${l} (${k})`} onClick={() => goMode(id)}><Icon n={'m-' + id} s={12} />{l}</button>)}</nav>
    <div className="tb-r">
      <button className="cmdk cbar" onClick={run(() => { S.overlay = { type: 'pal', query: '', sel: 0 } })} aria-keyshortcuts="Control+K"><span className="cb-p" aria-hidden="true">›</span><span>Ask, run or go to…</span><span className="cb-h" aria-hidden="true">@ / </span><Kbd>Ctrl K</Kbd></button>
      <button className={'needs' + (n ? '' : ' zero')} onClick={() => goScreen('queue')} title="Approvals waiting for you (Ctrl Shift A)">{n ? <span className="sun live" /> : <Icon n="check" s={12} />}{n ? `${n} need${n === 1 ? 's' : ''} you` : 'Nothing waiting'}</button>
      <button className="ibtn" onClick={e => { e.stopPropagation(); S.notif = !S.notif; S.menu = null; emit() }} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={S.notif} style={{ position: 'relative' }}><Icon n="bell" />{unread ? <span className="badge" style={{ position: 'absolute', top: 0, right: -2 }}>{unread}</span> : null}</button>
      <button className="ibtn" onClick={() => goScreen('settings-general')} aria-label="Settings (Ctrl ,)" title="Settings (Ctrl ,)"><Icon n="gear" /></button>
      <div className="wc" aria-hidden="true"><span><Icon n="min" s={12} /></span><span><Icon n="max" s={12} /></span><span><Icon n="x" s={12} /></span></div>
    </div></header>
}
const dlgOpen = (id: string) => () => { S.overlay = { type: 'dlg', id } }
MENUS.m_file = () => <><MI icon="plus" label="New conversation" sc="Ctrl Alt N" onClick={() => { S.overlay = { type: 'newtask', text: '' } }} /><MI icon="term" label="New terminal" onClick={() => { railGo('code') }} /><MI icon="folder" label="Add project…" onClick={() => { S.apPath = undefined; S.overlay = { type: 'dlg', id: 'addproject' } }} /><MI icon="plus" label="New workspace…" onClick={() => { S.nw = undefined; S.overlay = { type: 'dlg', id: 'newws' } }} /><hr /><MI icon="gear" label="Settings" sc="Ctrl ," onClick={() => goScreen('settings-general')} /><hr /><MI icon="x" label="Exit" onClick={dlgOpen('unsaved')} /></>
MENUS.m_edit = () => <>{([['Undo', 'Ctrl Z'], ['Redo', 'Ctrl Shift Z'], ['Cut', 'Ctrl X'], ['Copy', 'Ctrl C'], ['Paste', 'Ctrl V'], ['Select all', 'Ctrl A']] as const).map(([l, k]) => <MI key={l} label={l} sc={k} onClick={() => toast(`${l} (the focused field)`)} />)}<hr /><MI icon="search" label="Find in conversation" sc="Ctrl F" onClick={() => toast('Find bar opens above the conversation')} /></>
MENUS.m_view = () => <><MI icon="search" label="Command palette" sc="Ctrl K" onClick={() => { S.overlay = { type: 'pal', query: '', sel: 0 } }} /><MI icon="sidebar" label="Toggle sidebar" sc="Ctrl B" onClick={() => { S.sbCol = !S.sbCol }} /><hr /><div className="mg">Appearance</div><MI check={S.mode === 'light'} label="Light" onClick={() => { S.mode = 'light' }} /><MI check={S.mode === 'dark'} label="Dark" onClick={() => { S.mode = 'dark' }} /><hr /><div className="mg">Modes</div>{MODES.map(([id, l, k]) => <MI key={id} label={l} sc={k} onClick={() => goMode(id)} />)}</>
const dock = (id: string) => () => { S.area = 'mode'; S.mode2 = 'code'; S.codeDock = id; syncScreen() }
MENUS.m_tools = () => <><MI icon="globe" label="Browser" sc="Ctrl Shift B" onClick={dock('browser')} /><MI icon="phone" label="Android device" onClick={dock('android')} /><MI icon="net" label="HTTP calls" onClick={dock('http')} /><MI icon="box" label="Containers" onClick={dock('containers')} /><hr /><MI icon="plug" label="MCP servers" onClick={dlgOpen('mcp')} /><MI icon="play" label="Scripts" onClick={dock('scripts')} /><MI icon="key" label="What agents can do" onClick={() => goScreen('settings-permissions')} /><MI icon="activity" label="Agent activity" onClick={() => goScreen('settings-activity')} /><MI icon="users" label="Delegated work" onClick={dlgOpen('delegated')} /><MI icon="activity" label="Usage" onClick={dlgOpen('usage')} /><hr /><MI icon="cpu" label="Diagnostics" onClick={() => goScreen('settings-diagnostics')} /></>
MENUS.m_help = () => <><MI icon="keyboard" label="Keyboard shortcuts" sc="?" onClick={dlgOpen('shortcuts')} /><MI icon="warn" label="Report a problem…" onClick={dlgOpen('report')} /><MI icon="refresh" label="Check for updates" onClick={() => toast('You\'re on the latest version, 1.5.0')} /><hr /><MI icon="info" label="About OXESpace" onClick={dlgOpen('about')} /></>
MENUS.ws = () => <><div className="mg">Workspace</div><MI check label={D.company.name} hint="3 projects · ~/code/cajui" /><MI check={false} label="Personal" hint="1 project" onClick={() => toastSoonLocal('Switching workspaces reloads the window in the app.')} /><hr />
  <MI icon="plus" label="New workspace…" onClick={() => { S.nw = undefined; S.overlay = { type: 'dlg', id: 'newws' } }} /><MI icon="gear" label="Workspace settings" onClick={() => goScreen('settings-ws-projects')} /><hr /><MI icon="trash" dz label="Remove workspace…" onClick={() => { S.overlay = { type: 'dlg', id: 'removews' } }} /></>
import { toast, resolve } from '../state/store'
const toastSoonLocal = (m: string) => toast(m)

export function StatusBar () {
  const running = S.area === 'firstrun' ? 0 : S.tasks.filter(t => t.status === 'run').length
  const t = S.area === 'task' ? task(S.taskId) : null
  if (S.area === 'firstrun') return <footer className="sb"><span>Nothing set up yet</span><span className="sp" /><span>OXESpace 1.5.0</span></footer>
  return <footer className="sb"><span><Icon n="branch" s={12} /> <b>{t && t.id === 't143' ? 'mig-prd' : t ? t.branch : 'main'}</b>{t && t.id === 't143' ? <span className="moved-sb" title="This conversation started on oxe/t143-invoice-report; the worktree's branch changed">moved</span> : null}</span>{(() => { const w = t ? wsFor(t.project, TASK_WT[t.id]) : S.area === 'mode' && S.mode2 === 'code' ? curWs() : undefined; return w ? <span className="wschip sb-ws hide-n" data-ws={wsColor(w)} title={w.path}><span className="wsdot" />{wsName(w)}</span> : <span className="hide-n">cajui-api</span> })()}
    <span><span className="sdot on" /> {plural(running, 'agent')} working</span><span className="sp" />
    {S.freshWs ? null : <button className="usage-sb" onClick={run(() => { S.overlay = { type: 'dlg', id: 'usage' } })} title="Usage by provider"><span className="pdot claude" />Claude 41%<span className="ubar"><i style={{ width: '41%' }} /></span><span className="pdot codex" />Codex 18%<span className="ubar"><i style={{ width: '18%' }} /></span></button>}<span>OXESpace 1.5.0</span></footer>
}

const RAIL: [string, string, string][] = [['tasks', 'chat', 'OxeChat: tasks and threads'], ['code', 'term', 'OxeCode'], ['query', 'query', 'OxeQuery']]
export function railGo (v: string) {
  S.menu = null; S.notif = false
  if (v === 'tasks') { S.area = 'task'; S.emptyWs = false } else if (v === 'settings') { S.area = 'settings' } else if (v === 'found') { S.area = 'found' } else if (v === 'chat') { S.area = 'chat' } else { S.area = 'mode'; S.mode2 = v as Mode2 }
  syncScreen(); emit()
}
export function Rail () {
  const cur = S.area === 'task' || S.area === 'later-multi' || S.area === 'later-watch' ? 'tasks' : S.area === 'mode' ? S.mode2 : S.area
  const b = (id: string, icn: string, lbl: string, extra?: ReactNode) => <button key={id} onClick={() => id === 'queue' ? goScreen('queue') : railGo(id)} title={lbl} aria-label={lbl} aria-current={cur === id ? 'page' : undefined}><Icon n={icn} />{extra}</button>
  return <nav className="rail" aria-label="Modes">{RAIL.map(([id, icn, lbl]) => b(id, icn, lbl))}<span className="sp" />
    {b('queue', 'shield', 'Approvals', needsN() ? <span className="badge">{needsN()}</span> : null)}{b('found', 'palette', 'Foundations')}{b('settings', 'gear', 'Settings (Ctrl ,)')}</nav>
}

export function Notifications () {
  if (!S.notif) return null
  const list = S.extraNotifs.concat(D.notifications)
  return <div className="notif" role="dialog" aria-label="Notifications" onClick={e => e.stopPropagation()}>
    <div className="notif-h"><h3>Notifications</h3><button className="btn ghost sm" onClick={run(() => { D.notifications.forEach(n => { S.notifRead[n.id] = true }); S.extraNotifs = []; toast('All notifications marked read') })}>Mark all read</button><button className="ibtn sm" onClick={run(() => { S.notif = false })} aria-label="Close"><Icon n="x" /></button></div>
    <div className="notif-l">{list.map(n => <button key={n.id} className={`ni ${n.kind}${S.notifRead[n.id] ? ' read' : ''}`} onClick={() => { S.notif = false; S.notifRead[n.id] = true; S.taskId = n.task; S.tab = 'conv'; S.area = 'task'; syncScreen(); emit() }}><i /><Html html={n.text} /><span className="m-time">{n.at}</span></button>)}</div>
    <div className="dlg-f"><span className="muted" style={{ fontSize: 12 }}>Needs you, Finished and Failed also reach your phone when it's paired and on the same Wi-Fi.</span><span className="sp" /><button className="btn sm" onClick={() => { S.notif = false; S.page = 'notifications'; goScreen('settings-notifications') }}>Notification settings</button></div></div>
}

export function MenuLayer () {
  const m = S.menu; if (!m) return null
  const b = MENUS[m.id]; if (!b) return null
  const wide = m.pop ? 280 : 260
  const style: Record<string, number> = {}
  if (m.x + wide > S.w - 8) style.right = Math.max(8, m.r); else style.left = m.x
  if (m.y > H() - 280) style.bottom = H() - m.top + 4; else style.top = m.y
  return <div className={m.pop ? 'pop' : 'menu'} role={m.pop ? 'dialog' : 'menu'} style={style} onClick={e => e.stopPropagation()}
    ref={el => { if (el && !el.dataset.f) { el.dataset.f = '1'; const f = el.querySelector<HTMLElement>('.mi:not([aria-disabled]), button, input'); f && f.focus() } }}
    onKeyDown={e => { const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.mi:not([aria-disabled])')); const i = items.indexOf(document.activeElement as HTMLElement); if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() } if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() } }}>{b()}</div>
}

export function Toasts () {
  return <div className="toasts" aria-live="polite">{S.toasts.map(t => <div key={t.id} className={'toast ' + (t.kind || '')} role="status">{t.kind === 'attn' ? <span className="sun live" /> : null}<span>{t.text}</span>
    {t.undo ? <button className="btn sm" onClick={run(() => { t.undo!(); S.toasts = S.toasts.filter(x => x.id !== t.id) })}><Icon n="undo" s={12} />Undo</button> : null}
    {t.go ? <button className="btn sm" onClick={() => { S.toasts = S.toasts.filter(x => x.id !== t.id); goScreen(t.go!) }}>Open</button> : null}
    {t.ap && !S.resolved[t.ap] ? (D.approvals[t.ap].irreversible ? <button className="btn sm" onClick={run(() => { S.toasts = S.toasts.filter(x => x.id !== t.id); S.overlay = { type: 'approve', id: t.ap } })}>See impact</button> : <><button className="btn sm" onClick={run(() => { S.toasts = S.toasts.filter(x => x.id !== t.id); resolve(t.ap!, 'deny') })}>Deny</button><button className="btn sm" onClick={run(() => { S.toasts = S.toasts.filter(x => x.id !== t.id); resolve(t.ap!, 'ok') })}>Allow</button></>) : null}</div>)}</div>
}
