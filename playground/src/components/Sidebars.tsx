/* The two sidebars keep 1.4's structure exactly (user decision 04/11: "the way to add a workspace in OxeCode and OxeChat
   must not change; I work by worktree"). OxeChat: Conversations · Add project · filter · Pinned · Projects → project groups
   with sections. OxeCode: Workspaces · New workspace · Delegated work · Files & commands · filter · workspace cards with
   their terminals. What 1.5 adds is on top: the workspace color (T85), status glyphs on rows, the drift glyph. */
import { D } from '../mock/data'
import type { Task } from '../mock/types'
import { S, emit, run, plural, toast } from '../state/store'
import { Icon, Kbd, MI, menuBtn } from './ui'
import { MENUS } from './Shell'
import { syncScreen, goScreen } from '../screens/registry'
import { WORKSPACES, WS_COLORS, projColor, type Workspace } from '../mock/workspaces'
import { STATUS_LABEL, openTask, openBeside } from './Task'
import { wsList, wsName, wsColor, curWs } from '../state/ws'
export { wsList, wsName, wsColor, curWs }

/* ================================================================ OxeChat */
/** Sections a project's conversations are grouped under (1.4 "New section…"). Conversations not in one sit below. */
const SECTIONS: Record<string, [string, string[]][]> = { api: [['Pix', ['t147', 't144']]] }
const SHOW = 5
function ConvRow ({ t, col }: { t: Task; col: boolean }) {
  const on = (S.area === 'task' || S.area === 'later-multi') && S.taskId === t.id
  const moved = t.id === 't143'
  return <div className="trow-w"><button className="trow" onClick={() => openTask(t.id)} aria-current={on ? 'page' : undefined} aria-describedby={'st-' + t.id}>
    <span className={'sg ' + t.status} /><span className="tt trunc">{moved ? <span className="drift-g" aria-hidden="true"><Icon n="branch" s={12} /></span> : null}{t.title}</span><span className="tm">{t.status === 'run' || t.status === 'needs' ? t.mins + 'm' : t.started}</span>
    {t.status === 'needs' && !S.chatCompact ? <span className="meta"><span className="trunc attn-t">{t.now.replace('Waiting for you: ', 'Asks to ').replace('Waiting for your answer: ', 'Asks you ').replace('Needs you: ', 'Asks to ')}</span></span> : null}
    <span id={'st-' + t.id} className="sr">{STATUS_LABEL[t.status]}{moved ? ', branch moved' : ''}</span>{col ? <span className="tipc">{t.title} · {STATUS_LABEL[t.status]}{moved ? ' · branch moved' : ''}</span> : null}</button>
    {!col && t.id !== S.taskId ? <button className="beside" title="Open side by side" aria-label={`Open ${t.title} side by side`} onClick={e => { e.stopPropagation(); openBeside(t.id); emit() }}><Icon n="panel" s={12} /></button> : null}</div>
}
export function ChatSidebar () {
  const col = S.sbCol || (S.w === 900 && !!S.split2 && S.split2 !== S.taskId)
  const q = (S.filter || '').toLowerCase()
  const all = S.emptyWs || S.view === 'empty' ? [] : S.tasks.filter(t => t.id !== 'quick' && (!q || t.title.toLowerCase().includes(q)))
  const projects = Object.values(D.projects).filter(p => !S.removedProj?.includes(p.id) && (!S.freshWs || all.some(t => t.project === p.id)))
  const pinned = all.filter(t => t.pinned)
  const shut = S.projShut || {}
  return <aside className={'sbar' + (col ? ' col' : '') + (S.chatCompact ? ' compact' : '')} aria-label="OxeChat sidebar">
    <div className="sbar-h"><h2>Conversations</h2>
      {col ? null : <><button className="ibtn" onClick={run(() => { S.apPath = undefined; S.overlay = { type: 'dlg', id: 'addproject' } })} title="Add project" aria-label="Add project"><Icon n="folder" /></button>
      <button className="ibtn" onClick={run(() => { S.chatCompact = !S.chatCompact })} aria-pressed={!!S.chatCompact} title={S.chatCompact ? 'Use comfortable spacing' : 'Use compact spacing'} aria-label="Compact conversation list"><Icon n="list" /></button></>}
      <button className="ibtn" onClick={run(() => { S.sbCol = !S.sbCol; syncScreen() })} title={`${col ? 'Expand' : 'Collapse'} the sidebar (Ctrl B)`} aria-label={`${col ? 'Expand' : 'Collapse'} the sidebar`}><Icon n="sidebar" /></button></div>
    <div className="sbar-tools"><label className="search"><Icon n="search" s={12} /><input id="tsearch" placeholder="Filter conversations" aria-label="Filter conversations" value={S.filter || ''} onChange={e => { S.filter = e.target.value; emit() }} /><Kbd>/</Kbd></label></div>
    <div className="sbar-l">
      {col ? all.map(t => <ConvRow key={t.id} t={t} col />) : <>
        {pinned.length ? <section aria-label="Pinned"><div className="sh"><Icon n="pin" s={12} /><span>Pinned</span></div>{pinned.map(t => <ConvRow key={t.id} t={t} col={false} />)}</section> : null}
        <section aria-label="OxeChat projects"><div className="sh"><span>Projects</span></div>
          {projects.map(p => { const ts = all.filter(t => t.project === p.id && !t.pinned); if (q && !ts.length) return null
            const open = q ? true : !shut[p.id]; const secs = (SECTIONS[p.id] || []).map(([n, ids]) => [n, ts.filter(t => ids.includes(t.id))] as const).filter(s => s[1].length)
            const inSec = new Set(secs.flatMap(s => s[1].map(t => t.id))); const rest = ts.filter(t => !inSec.has(t.id))
            const more = S.projMore?.[p.id]; const shown = more ? rest : rest.slice(0, SHOW)
            const needs = ts.filter(t => t.status === 'needs').length
            return <div key={p.id} className="pg" data-ws={projColor(p.id)}>
              <div className="pg-h"><button className="pg-t" aria-expanded={open} onClick={run(() => { (S.projShut ||= {})[p.id] = open })}><Icon n={open ? 'down' : 'right'} s={12} /><span className="wsdot" aria-hidden="true" /><span className="trunc">{p.name}</span>{!open && needs ? <span className="sg needs" title={`${needs} need you`} /> : null}<span className="n">{ts.length}</span></button>
                <button className="ibtn sm" title={`New conversation in ${p.name}`} aria-label={`New conversation in ${p.name}`} onClick={run(() => { S.overlay = { type: 'newtask', text: '' }; S.newTask = { project: p.id, prov: 'claude', model: 'Opus 5.5', access: 'edit', worktree: true } })}><Icon n="plus" s={12} /></button>
                <button className="ibtn sm" aria-label={`${p.name} project actions`} title="Project actions" onClick={e => { S.projCtx = p.id; menuBtn('projact')(e) }}><Icon n="more" s={12} /></button></div>
              {open ? <div className="pg-b">
                {secs.map(([n, list]) => <div key={n} className="psec"><div className="psec-h"><span>{n}</span><span className="n">{list.length}</span></div>{list.map(t => <ConvRow key={t.id} t={t} col={false} />)}</div>)}
                {shown.map(t => <ConvRow key={t.id} t={t} col={false} />)}
                {rest.length > shown.length ? <button className="more-b" onClick={run(() => { (S.projMore ||= {})[p.id] = true })}>Show {rest.length - shown.length} more</button> : null}
                {!ts.length ? <p className="pg-e">{q ? 'No conversations found.' : 'No conversations yet.'}</p> : null}</div> : null}</div> })}
          {!projects.length ? <div className="state" style={{ padding: '24px 12px' }}><p style={{ fontSize: 12 }}>Add a project to start a conversation.</p><button className="btn sm" onClick={run(() => { S.apPath = undefined; S.overlay = { type: 'dlg', id: 'addproject' } })}><Icon n="folder" s={12} />Add project</button></div> : null}
        </section>
        {q && !all.length ? <div className="state" style={{ padding: '24px 12px' }}><p style={{ fontSize: 12 }}>No conversations found.</p></div> : null}</>}
    </div>
    <div className="sbar-f">{S.freshWs ? <><span className="sp" /><span className="lbl">{plural(all.length, 'conversation')}</span></> : col ? <button className="ibtn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'archived' } })} aria-label="Archived" title="Archived"><Icon n="archive" s={12} /></button>
      : <><button className="btn ghost sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'archived' } })}><Icon n="archive" s={12} /><span className="lbl">Archived · 14</span></button><span className="sp" /><span className="lbl">{plural(all.length, 'conversation')}</span></>}</div></aside>
}
MENUS.projact = () => { const p = D.projects[S.projCtx || 'api']; return <><MI icon="plus" label={`New conversation in ${p.name}`} onClick={() => { S.overlay = { type: 'newtask', text: '' }; S.newTask = { project: p.id, prov: 'claude', model: 'Opus 5.5', access: 'edit', worktree: true } }} /><MI icon="gear" label="Project settings" onClick={() => goScreen('settings-ws-projects')} /><MI icon="list" label="New section…" onClick={() => toast(`Sections group ${p.name}'s conversations under a name`)} /><MI icon="term" label="Open in OxeCode" onClick={() => { const w = WORKSPACES.find(x => x.project === p.id && !x.wt); if (w) S.ws = w.id; S.area = 'mode'; S.mode2 = 'code'; syncScreen() }} /><hr /><MI icon="trash" dz label="Remove project…" onClick={() => { S.overlay = { type: 'dlg', id: 'removeproj' } }} /></> }

/* ================================================================ OxeCode */
type Tone = 'needs-decision' | 'thinking' | 'awaiting' | 'idle' | 'error' | 'exited'
const TONE_LABEL: Record<Tone, string> = { 'needs-decision': 'needs your decision', thinking: 'thinking', awaiting: 'awaiting', idle: 'idle', error: 'needs attention', exited: 'exited' }
export function paneTone (k: { by: string; prov?: string; tag?: string }): Tone {
  const t = k.tag ? S.tasks.find(x => x.title === k.tag) : undefined
  if (t) return t.status === 'needs' ? 'needs-decision' : t.status === 'run' ? 'thinking' : t.status === 'err' ? 'error' : 'awaiting'
  return k.by === 'agent' ? 'thinking' : 'idle'
}
function dominant (panes: { by: string; prov?: string; tag?: string }[]): Tone | null {
  const ts = panes.map(paneTone); for (const x of ['needs-decision', 'error', 'thinking', 'awaiting'] as Tone[]) if (ts.includes(x)) return x; return panes.length ? 'idle' : null
}
export function CodeSidebar ({ panesOf, onPane }: { panesOf: (id: string) => { id: string; name: string; by: string; prov?: string; tag?: string; branch?: string; moved?: string }[]; onPane: (ws: string, i: number) => void }) {
  const q = (S.wsFilter || '').toLowerCase()
  const list = wsList().filter(w => !q || (wsName(w) + ' ' + w.path).toLowerCase().includes(q) || panesOf(w.id).some(k => (k.name + ' ' + (k.tag || '')).toLowerCase().includes(q)))
  const exp = S.wsOpen || {}
  if (S.codeSbCol) return <aside className="mode-side ws-rail" aria-label="Workspaces">
    <button className="ibtn" onClick={run(() => { S.codeSbCol = false; syncScreen() })} title="Expand the sidebar (Ctrl B)" aria-label="Expand the sidebar"><Icon n="sidebar" /></button>
    <nav className="ws-rail-l" aria-label="Workspaces">{wsList().map(w => { const tone = dominant(panesOf(w.id)); const active = w.id === S.ws
      return <button key={w.id} className={'ws-rail-i' + (active ? ' active' : '')} data-ws={wsColor(w)} aria-current={active ? 'page' : undefined} title={wsName(w)} aria-label={wsName(w) + (tone === 'needs-decision' ? ', needs your decision' : '')} onClick={run(() => { S.ws = w.id; S.codeMax = null })}><span className="wsdot" />{tone === 'needs-decision' ? <span className="sg needs" /> : null}</button> })}</nav>
    <button className="ibtn" title="New workspace" aria-label="New workspace" onClick={run(() => { S.nw = undefined; S.overlay = { type: 'dlg', id: 'newws' } })}><Icon n="plus" /></button></aside>
  return <aside className="mode-side ws-side ws14" aria-label="Workspaces">
    <div className="mside-h"><b>Workspaces</b><span className="sp" />
      <button className="ibtn sm" title="New workspace" aria-label="New workspace" data-testid="btn-new-workspace" onClick={run(() => { S.nw = undefined; S.overlay = { type: 'dlg', id: 'newws' } })}><Icon n="plus" s={12} /></button>
      <button className="ibtn sm" title="Delegated work" aria-label="Delegated work" onClick={run(() => { S.overlay = { type: 'dlg', id: 'delegated' } })}><Icon n="layers" s={12} /></button>
      <button className="ibtn sm" title="Files & commands (Ctrl P)" aria-label="Files & commands" onClick={run(() => { S.overlay = { type: 'pal', query: '', sel: 0 } })}><Icon n="search" s={12} /></button>
      <button className="ibtn sm" title="Collapse the sidebar (Ctrl B)" aria-label="Collapse the sidebar" onClick={run(() => { S.codeSbCol = true; syncScreen() })}><Icon n="sidebar" s={12} /></button></div>
    <div className="sbar-tools"><label className="search"><Icon n="search" s={12} /><input placeholder="Filter workspaces" aria-label="Filter workspaces" value={S.wsFilter || ''} onChange={e => { S.wsFilter = e.target.value; emit() }} /><Kbd>/</Kbd></label></div>
    <div className="scroll"><div className="sh"><span>Workspaces</span><span className="sp" /><button className="ibtn sm" aria-label="Toggle all workspace terminals" title="Toggle all workspace terminals" onClick={run(() => { const anyOpen = list.some(w => exp[w.id] ?? w.id === S.ws); S.wsOpen = Object.fromEntries(list.map(w => [w.id, !anyOpen])) })}><Icon n="down" s={12} /></button></div>
      <nav className="wsl" aria-label="Workspaces">{list.length ? list.map(w => { const panes = panesOf(w.id); const active = w.id === S.ws; const open = !!q || (exp[w.id] ?? active); const tone = dominant(panes)
        return <section key={w.id} className={'wsc' + (active ? ' active' : '') + (S.wsDragOver === w.id ? ' dropt' : '')} data-ws={wsColor(w)}
          onDragOver={e => { if (S.wsDrag && S.wsDrag !== w.id) { e.preventDefault(); if (S.wsDragOver !== w.id) { S.wsDragOver = w.id; emit() } } }}
          onDrop={e => { e.preventDefault(); const from = S.wsDrag; S.wsDrag = undefined; S.wsDragOver = undefined; if (!from || from === w.id) { emit(); return } const o = wsList().map(x => x.id).filter(x => x !== from); o.splice(o.indexOf(w.id), 0, from); S.wsOrder = o; emit() }}>
          <div className="wsc-h" draggable onDragStart={() => { S.wsDrag = w.id }} onDragEnd={() => { S.wsDrag = undefined; S.wsDragOver = undefined; emit() }} onContextMenu={e => { e.preventDefault(); S.wsCtx = w.id; menuBtn('wsopts')(e) }}>
            <span className="grip" aria-hidden="true">⋮⋮</span><span className={'adot ' + (tone || 'none')} title={tone ? TONE_LABEL[tone] : undefined} aria-hidden="true" />
            {S.wsRenaming === w.id ? <input className="input sm" autoFocus aria-label={`Rename workspace ${wsName(w)}`} defaultValue={wsName(w)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { (S.wsNames ||= {})[w.id] = e.currentTarget.value.trim() || w.name; S.wsRenaming = undefined; emit() } if (e.key === 'Escape') { S.wsRenaming = undefined; emit() } }} onBlur={e => { (S.wsNames ||= {})[w.id] = e.currentTarget.value.trim() || w.name; S.wsRenaming = undefined; emit() }} />
              : <button className="wsc-n" aria-current={active ? 'true' : undefined} title={`${wsName(w)}\n${w.path}\n(right-click for options)`} onClick={run(() => { S.ws = w.id; S.code.focus = 0; S.codeMax = null; syncScreen() })}><span className="trunc">{wsName(w)}</span><span className="wsc-b trunc">{w.wt ? 'worktree · ' : ''}{w.branch}</span></button>}
            {panes.length ? <button className="ibtn sm" aria-label={`${plural(panes.length, 'terminal')} in ${wsName(w)}`} title={plural(panes.length, 'terminal')} aria-expanded={open} onClick={run(() => { (S.wsOpen ||= {})[w.id] = !open })}><Icon n={open ? 'down' : 'right'} s={12} /></button> : null}
            <button className="ibtn sm" title="Options" aria-label="Workspace options" onClick={e => { S.wsCtx = w.id; menuBtn('wsopts')(e) }}><Icon n="gear" s={12} /></button></div>
          {open && panes.length ? <div className="wsc-p">{panes.map((k, i) => { const tn = paneTone(k)
            return <button key={k.id + i} className="psr" aria-current={active && S.code.focus === i ? 'true' : undefined} onClick={run(() => onPane(w.id, i))}>
              <span className={'adot ' + tn} aria-hidden="true" /><span className="psr-n">{k.prov ? <span className={'pdot ' + k.prov} /> : <Icon n="term" s={12} />}<span className="trunc">{k.tag || k.name}</span></span>
              {k.moved || (k.branch && k.branch !== w.branch) ? <span className={'bb' + (k.moved ? ' moved' : '')} title={k.moved ? `Started on ${k.moved}; the branch has changed since` : 'This pane is on another branch'}>{k.moved ? <Icon n="warn" s={12} /> : <Icon n="branch" s={12} />}<span className="trunc">{k.branch}</span></span> : <span />}
              <span className="psr-s">{k.tag ? `${k.name} · ` : ''}{TONE_LABEL[tn]}</span><span className="sr">, {TONE_LABEL[tn]}{k.moved ? ', branch moved' : ''}</span></button> })}</div> : null}
        </section> }) : <div className="state" style={{ padding: '24px 12px' }}><p style={{ fontSize: 12 }}>{q ? 'No matching workspaces.' : 'No workspaces yet.'}</p>{q ? null : <button className="btn sm" onClick={run(() => { S.nw = undefined; S.overlay = { type: 'dlg', id: 'newws' } })}><Icon n="plus" s={12} />New workspace</button>}</div>}</nav></div>
    <div className="mside-f"><button className="btn sm ghost" onClick={menuBtn('panels')}><Icon n="grid" s={12} />Open panels</button></div></aside>
}
MENUS.wsopts = () => { const w = WORKSPACES.find(x => x.id === S.wsCtx) || curWs(); const o = wsList(); const i = o.indexOf(w); const move = (d: number) => { const ids = o.map(x => x.id); ids.splice(i, 1); ids.splice(i + d, 0, w.id); S.wsOrder = ids }
  return <><MI icon="pencil" label="Rename" onClick={() => { S.wsRenaming = w.id }} /><MI icon="gear" label="Workspace settings" onClick={() => { S.wsCtx = w.id; goScreen('settings-ws-policy') }} /><MI label="Move up" dis={i <= 0} onClick={() => move(-1)} /><MI label="Move down" dis={i >= o.length - 1} onClick={() => move(1)} />
    <hr /><div className="mg">Color · new in 1.5.0</div><div className="swatches" role="radiogroup" aria-label="Workspace color">{WS_COLORS.map(([n, l]) => <button key={n} role="radio" aria-checked={wsColor(w) === n} title={l} aria-label={l} style={{ background: `var(--ws-${n})` }} onClick={() => { (S.wsColors ||= {})[w.id] = n; S.menu = null; emit() }} />)}</div>
    <hr /><MI icon="trash" dz label="Remove workspace" onClick={() => { S.wsCtx = w.id; S.overlay = { type: 'dlg', id: 'removews' } }} /></> }
MENUS.panels = () => <>{([['files', 'file', 'Files'], ['changes', 'diff', 'Changes'], ['browser', 'globe', 'Browser'], ['worktrees', 'layers', 'Worktrees'], ['git', 'pr', 'Git'], ['scripts', 'play', 'Scripts'], ['bg', 'activity', 'Background']] as const).map(([id, ic, l]) => <MI key={id} icon={ic} label={l} onClick={() => { S.codeDock = id }} />)}</>
