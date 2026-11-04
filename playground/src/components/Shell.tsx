/* App chrome: title bar, mode rail, status bar, notifications, menus and toasts. */
import type { ReactNode } from 'react'
import { D } from '../mock/data'
import { S, emit, run, task, money, plural, needsN, H, type Mode2 } from '../state/store'
import { Icon, Logo, Kbd, MI, menuBtn, Html } from './ui'
import { goScreen, syncScreen } from '../screens/registry'

export const MENUS: Record<string, () => ReactNode> = {}

export function TitleBar () {
  const n = needsN()
  const unread = D.notifications.filter(x => !S.notifRead[x.id]).length + S.extraNotifs.length
  return <header className="tb">
    <div className="tb-l"><Logo /><button className="ws" onClick={menuBtn('ws')} aria-haspopup="menu">{D.company.name} <small className="hide-n">3 projects</small><Icon n="down" s={12} /></button></div>
    <button className="cmdk" onClick={run(() => { S.overlay = { type: 'pal', query: '', sel: 0 } })} aria-label="Search or run a command (Ctrl K)"><Icon n="search" /><span>Search tasks, files, queries or run a command</span><Kbd>Ctrl K</Kbd></button>
    <div className="tb-r">
      <button className={'needs' + (n ? '' : ' zero')} onClick={() => goScreen('queue')} title="Approvals waiting for you">{n ? <span className="sun live" /> : <Icon n="check" s={12} />}{n ? `${n} need${n === 1 ? 's' : ''} you` : 'Nothing waiting'}</button>
      <button className="ibtn" onClick={e => { e.stopPropagation(); S.notif = !S.notif; S.menu = null; emit() }} aria-label="Notifications" aria-expanded={S.notif} style={{ position: 'relative' }}><Icon n="bell" />{unread ? <span className="badge" style={{ position: 'absolute', top: 0, right: -2 }}>{unread}</span> : null}</button>
      <div className="wc" aria-hidden="true"><span><Icon n="min" s={12} /></span><span><Icon n="max" s={12} /></span><span><Icon n="x" s={12} /></span></div>
    </div></header>
}
MENUS.ws = () => <><div className="mg">Workspace</div><MI check label={D.company.name} hint="3 projects · ~/code/cajui" /><MI check={false} label="Personal" hint="1 project" onClick={() => toastSoonLocal('Switching workspaces reloads the window in the app.')} /><hr />
  <MI icon="plus" label="New workspace…" onClick={() => { S.overlay = { type: 'dlg', id: 'newws' } }} /><MI icon="gear" label="Workspace settings" onClick={() => goScreen('settings-ws')} /><hr /><MI icon="trash" dz label="Remove workspace…" onClick={() => { S.overlay = { type: 'dlg', id: 'removews' } }} /></>
import { toast } from '../state/store'
const toastSoonLocal = (m: string) => toast(m)

export function StatusBar () {
  const running = S.tasks.filter(t => t.status === 'run').length
  const t = S.area === 'task' ? task(S.taskId) : null
  return <footer className="sb"><span><Icon n="branch" s={12} /> <b>{t ? t.branch : 'main'}</b></span><span className="hide-n">{t ? D.projects[t.project].name : 'cajui-api'}</span>
    <span><span className="sdot on" /> {plural(running, 'agent')} working</span><span className="sp" />
    <span className="hide-n">Today {money(S.tasks.reduce((s, x) => s + (x.started.includes(':') ? x.cost : 0), 0))}</span><span className="hide-n">Claude Max · 41% of the 5 h window</span><span>OXESpace 1.5.0</span></footer>
}

const RAIL: [string, string, string][] = [['tasks', 'list', 'Tasks'], ['code', 'term', 'OxeCode'], ['query', 'query', 'OxeQuery'], ['post', 'net', 'OxePost'], ['pod', 'box', 'OxePod'], ['chat', 'chat', 'OxeChat']]
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
    <div className="dlg-f"><span className="muted" style={{ fontSize: 12 }}>Approvals also reach your phone when it's paired.</span><span className="sp" /><button className="btn sm" onClick={() => { S.notif = false; S.page = 'notifications'; goScreen('settings-notifications') }}>Notification settings</button></div></div>
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
    {t.go ? <button className="btn sm" onClick={() => { S.toasts = S.toasts.filter(x => x.id !== t.id); goScreen(t.go!) }}>Open</button> : null}</div>)}</div>
}
