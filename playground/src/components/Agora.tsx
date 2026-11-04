/* T82 · Agora: every agent in every workspace, right now. One read-only list built on the S7.1 agents read model
   (#514/#531): id, provider, model, surface (conversation | pane), workspace, title, tone, startedAt, lastActivity,
   pendingRequest. No invented fields. It acts in place with the same rules as everywhere else: Deny is the focused
   default, anything irreversible goes through the impact preview and its hold. Rendered only while open. */
import { D } from '../mock/data'
import type { Task } from '../mock/types'
import { S, emit, run, task, plural, toast, resolve, sendMsg, prov } from '../state/store'
import { Icon, Av, Kbd } from './ui'
import { openTask } from './Task'
import { syncScreen } from '../screens/registry'
import { WORKSPACES, wsFor, TASK_WT, type Workspace } from '../mock/workspaces'
import { wsName, wsColor, paneTone } from './Sidebars'
import { panesOf } from './Modes'

type Tone = 'needs' | 'run' | 'review' | 'err' | 'done' | 'idle'
interface Agent { id: string; surface: 'conversation' | 'pane'; ws: Workspace; title: string; prov: string; model: string; tone: Tone; since: string; last: string; now: string; t?: Task; pane?: { ws: string; i: number }; request?: string; ask?: boolean }
const TONE: Record<Tone, string> = { needs: 'Needs you', run: 'Working', review: 'Ready for review', err: 'Stopped', done: 'Done', idle: 'Paused' }

/** The read model, as the S7.1 endpoint returns it: conversations plus agent CLIs running in OxeCode panes. */
export function agents (): Agent[] {
  const out: Agent[] = S.tasks.filter(t => t.id !== 'quick').map(t => {
    const req = S.queue.find(q => !S.resolved[q] && D.approvals[q].task === t.id)
    return { id: t.id, surface: 'conversation' as const, ws: wsFor(t.project, TASK_WT[t.id])!, title: t.title, prov: t.prov, model: t.model, tone: t.status as Tone, since: t.status === 'run' || t.status === 'needs' ? `${t.mins} min` : t.started, last: t.now, now: t.now, t, request: req, ask: !!t.ask || t.id === 't147' && t.status === 'needs' }
  })
  for (const w of WORKSPACES) panesOf(w.id).forEach((k, i) => {
    if (!k.prov || (k.tag && S.tasks.some(t => t.title === k.tag))) return
    const tn = paneTone(k)
    out.push({ id: 'p-' + k.id, surface: 'pane', ws: w, title: k.tag || `${k.prov === 'claude' ? 'Claude Code' : 'Codex'} in ${wsName(w)}`, prov: k.prov, model: k.prov === 'claude' ? 'Opus 5.5' : 'GPT-5 Codex', tone: tn === 'thinking' ? 'run' : tn === 'needs-decision' ? 'needs' : 'idle', since: '12 min', last: k.lines.filter(l => l[1]).slice(-1)[0]?.[1]?.trim() || 'Waiting at the prompt', now: 'Waiting at the prompt', pane: { ws: w.id, i } })
  })
  return out
}
function open (a: Agent) { if (a.t) openTask(a.t.id); else if (a.pane) { S.ws = a.pane.ws; S.code.focus = a.pane.i; S.area = 'mode'; S.mode2 = 'code'; syncScreen(); emit() } }
function steer (a: Agent) {
  const text = (S.agSteer?.[a.id] || '').trim(); if (!text) return
  if (a.t) { S.drafts[a.t.id] = text; sendMsg(a.t) } else toast(`Typed into the ${a.prov === 'claude' ? 'Claude Code' : 'Codex'} pane in ${wsName(a.ws)}`)
  S.agSteer![a.id] = ''; S.agOpen = undefined; emit()
}
function Steer ({ a }: { a: Agent }) {
  return <form className="ag-steer" onSubmit={e => { e.preventDefault(); steer(a) }}><input className="input" autoFocus aria-label={`Tell ${prov(a.prov).name} something on "${a.title}"`} placeholder={a.tone === 'run' ? 'Steer it: it reads this after the current step' : 'Tell it what to do next'} value={S.agSteer?.[a.id] || ''} onChange={e => { (S.agSteer ||= {})[a.id] = e.target.value; emit() }} onKeyDown={e => { if (e.key === 'Escape') { S.agOpen = undefined; emit() } }} />
    <button className="btn sm pri" disabled={!(S.agSteer?.[a.id] || '').trim()}>Send <Kbd>Enter</Kbd></button></form>
}
function NeedsCard ({ a, first }: { a: Agent; first: boolean }) {
  const ap = a.request ? D.approvals[a.request] : null
  return <article className="ag-need" style={{ ['--wsc' as string]: `var(--ws-${wsColor(a.ws)})` }} aria-label={`${a.title} needs you`}>
    <header><span className="wschip"><span className="wsdot" />{wsName(a.ws)}</span><Av p={a.prov} /><button className="ag-t" onClick={() => open(a)}>{a.title}</button><span className="sp" /><span className="muted mono" style={{ fontSize: 11 }}>{a.since}</span></header>
    {ap ? <><p className="ag-ask"><b>{ap.title}</b> <span className="muted">· {ap.where}</span>{ap.irreversible ? <span className="pill danger" style={{ height: 18, marginLeft: 6 }}>can't be undone</span> : null}</p>
      <div className="ag-acts"><button className="btn sm" autoFocus={first} onClick={run(() => resolve(ap.id, 'deny'))}>Deny <Kbd>D</Kbd></button>
        {ap.irreversible ? <button className="btn sm pri" onClick={run(() => { S.overlay = { type: 'approve', id: ap.id } })}>See impact…</button> : <button className="btn sm pri" onClick={run(() => resolve(ap.id, 'ok'))}>Allow</button>}
        <span className="sp" /><button className="btn sm ghost" onClick={run(() => { S.agOpen = a.id })}>Tell it something else</button></div></>
      : <><p className="ag-ask"><b>{a.now.replace('Waiting for your answer: ', 'Asks you ')}</b></p><div className="ag-acts"><button className="btn sm pri" autoFocus={first} onClick={() => open(a)}>Answer in the conversation</button><span className="sp" /><button className="btn sm ghost" onClick={run(() => { S.agOpen = a.id })}>Tell it something else</button></div></>}
    {S.agOpen === a.id ? <Steer a={a} /> : null}</article>
}
export function Agora () {
  const all = agents(); const f = S.agFilter || 'all'
  const match = (a: Agent) => f === 'all' || (f === 'needs' ? a.tone === 'needs' : f === 'run' ? a.tone === 'run' : f === 'err' ? a.tone === 'err' || a.tone === 'idle' : a.tone === 'done' || a.tone === 'review')
  const needs = all.filter(a => a.tone === 'needs')
  const count = (k: string) => all.filter(a => k === 'all' || (k === 'needs' ? a.tone === 'needs' : k === 'run' ? a.tone === 'run' : k === 'err' ? a.tone === 'err' || a.tone === 'idle' : a.tone === 'done' || a.tone === 'review')).length
  const groups = WORKSPACES.filter(w => !S.wsGone?.includes(w.id)).map(w => [w, all.filter(a => a.ws.id === w.id && match(a))] as const).filter(g => g[1].length)
  return <div className="agora">
    <header className="ag-h"><div><h1>Agora</h1><p>Every agent in every workspace, right now. Act here or open it where it runs.</p></div><span className="sp" />
      <div className="seg" role="radiogroup" aria-label="Show">{([['all', 'All'], ['needs', 'Needs you'], ['run', 'Working'], ['err', 'Stopped or paused'], ['done', 'Done or in review']] as const).map(([k, l]) => <button key={k} role="radio" aria-checked={f === k} onClick={run(() => { S.agFilter = k })}>{l}<span className="n">{count(k)}</span></button>)}</div></header>
    <div className="ag-body scroll">
      {needs.length && (f === 'all' || f === 'needs') ? <section className="ag-needs" aria-label="Needs you"><h2><span className="sun" />Needs you <span className="n">{needs.length}</span></h2><div className="ag-ngrid">{needs.map((a, i) => <NeedsCard key={a.id} a={a} first={i === 0} />)}</div></section> : null}
      {groups.map(([w, list]) => { const shut = S.agShut?.[w.id]; const done = list.filter(a => a.tone === 'done'); const live = list.filter(a => a.tone !== 'done'); const showDone = f !== 'all' || S.agDone?.[w.id]
        return <section key={w.id} className="ag-ws" style={{ ['--wsc' as string]: `var(--ws-${wsColor(w)})` }} aria-label={wsName(w)}>
          <h2><button aria-expanded={!shut} onClick={run(() => { (S.agShut ||= {})[w.id] = !shut })}><Icon n={shut ? 'right' : 'down'} s={12} /><span className="wsdot" /><span>{wsName(w)}</span><span className="mono muted">{w.wt ? 'worktree · ' : ''}{w.branch}</span><span className="n">{plural(list.length, 'agent')}</span></button></h2>
          {shut ? null : <div className="ag-rows" role="list">{(showDone ? list : live).map(a => <div key={a.id} role="listitem" className={'ag-row tone-' + a.tone}>
            <span className={'sg ' + a.tone} aria-hidden="true" /><Av p={a.prov} size="s16" /><button className="ag-t trunc" onClick={() => open(a)} title={`Open where it runs (${a.surface === 'pane' ? 'OxeCode pane' : 'OxeChat'})`}>{a.title}</button>
            <span className="ag-src">{a.surface === 'pane' ? <><Icon n="term" s={12} />pane</> : <><Icon n="chat" s={12} />chat</>}</span>
            <span className="ag-now trunc">{TONE[a.tone]} · {a.now}</span><span className="mono muted ag-since">{a.since}</span>
            <span className="ag-ra">{a.tone === 'run' || a.tone === 'needs' || a.tone === 'idle' || a.tone === 'review' ? <button className="btn sm" onClick={run(() => { S.agOpen = S.agOpen === a.id ? undefined : a.id })} aria-expanded={S.agOpen === a.id}>Steer</button> : null}
              {a.tone === 'run' ? <button className="btn sm" onClick={run(() => { S.agStop = a.id; S.overlay = { type: 'dlg', id: 'agstop' } })}><Icon n="stop" s={12} />Stop</button> : null}
              <button className="ibtn sm" aria-label={`Open ${a.title}`} title="Open" onClick={() => open(a)}><Icon n="ext" s={12} /></button></span>
            {S.agOpen === a.id && a.tone !== 'needs' ? <div className="ag-sx"><Steer a={a} /></div> : null}</div>)}
            {!showDone && done.length ? <button className="more-b" onClick={run(() => { (S.agDone ||= {})[w.id] = true })}>Show {plural(done.length, 'finished agent')}</button> : null}</div>}</section> })}
      {!groups.length ? <div className="state" style={{ padding: 40 }}><p>No agents match this filter.</p></div> : null}
    </div>
    <footer className="ag-f muted"><span>Built on the agents read model (S7.1). Requests from MCP never show Allow here: they wait in their conversation.</span><span className="sp" /><span>Deny is focused first · <Kbd>Ctrl 0</Kbd> opens Agora</span></footer></div>
}
export const agoraNeeds = () => agents().filter(a => a.tone === 'needs').length
export function stopAgent () { const a = agents().find(x => x.id === S.agStop); if (!a) return; if (a.t) { a.t.status = 'idle'; a.t.now = 'Stopped by you. The work so far is kept.' } toast(`Stopped "${a.title}"`) }
export const agTask = (id?: string) => (id ? task(id) : undefined)
