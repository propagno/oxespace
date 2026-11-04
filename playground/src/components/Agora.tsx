/* T82 · Agora: every agent in every workspace, right now. Built only on the S7.1 agents read model (#514/#531):
   kind (thread | pane | delegation | work), id, state (the 7 states, mapped in main), provider, mode, title, workspaceId,
   since (when it entered its state), seenAt, requests[] {title, risk, answerable}, parent, and the per-source status.
   - The words are the phone's (#521): Needs you, Failed, Working, Finished, Idle, Stopped, Not confirmed.
   - The activity line is for conversations only, from the main-built `activity` field (T90). Terminal text never
     enters the model, so pane agents show state and since only, with no model and no Stop.
   - Acting in place follows the usual rules: Deny focused; A/D on the focused card; irreversible goes through the
     impact preview and its hold. Rendered only while open. */
import { useEffect, useRef } from 'react'
import { D } from '../mock/data'
import type { Task } from '../mock/types'
import { S, emit, run, task, plural, toast, resolve, sendMsg, prov, needsN } from '../state/store'
import { Icon, Av, Kbd } from './ui'
import { openTask } from './Task'
import { syncScreen } from '../screens/registry'
import { WORKSPACES, wsFor, TASK_WT, type Workspace } from '../mock/workspaces'
import { wsName, wsColor, paneTone } from './Sidebars'
import { panesOf } from './Modes'
import { refocus } from './Tools'

export type AgState = 'needs-you' | 'failed' | 'working' | 'finished' | 'idle' | 'stopped' | 'unknown'
export const STATE_WORD: Record<AgState, string> = { 'needs-you': 'Needs you', failed: 'Failed', working: 'Working', finished: 'Finished', idle: 'Idle', stopped: 'Stopped', unknown: 'Not confirmed' }
const GLYPH: Record<AgState, string> = { 'needs-you': 'needs', failed: 'err', working: 'run', finished: 'done', idle: 'idle', stopped: 'stopped', unknown: 'unknown' }
type Kind = 'thread' | 'pane' | 'delegation' | 'work'
interface Agent { id: string; kind: Kind; ws: Workspace; title: string; prov: string; model?: string; state: AgState; since: string; activity?: string; sub?: string; t?: Task; pane?: { ws: string; i: number }; request?: string; parent?: string }

const TASK_STATE: Record<string, AgState> = { needs: 'needs-you', run: 'working', review: 'finished', done: 'finished', err: 'failed', idle: 'stopped' }
const PANE_STATE: Record<string, AgState> = { 'needs-decision': 'needs-you', thinking: 'working', error: 'failed', idle: 'idle', awaiting: 'idle', exited: 'stopped' }
const sinceOf = (st: AgState, mins: number, at: string) => (st === 'working' || st === 'needs-you' ? `for ${mins} min` : `since ${at}`)

/** The read model, as S7.1 returns it. Work runs come from a source that can fail on its own (playground: S.agWorkOk). */
export function agents (): Agent[] {
  const out: Agent[] = S.tasks.filter(t => t.id !== 'quick').map(t => {
    const st = TASK_STATE[t.status] || 'unknown'; const req = S.queue.find(q => !S.resolved[q] && D.approvals[q].task === t.id)
    return { id: t.id, kind: 'thread' as const, ws: wsFor(t.project, TASK_WT[t.id])!, title: t.title, prov: t.prov, model: t.model, state: st, since: sinceOf(st, t.mins, t.started), activity: t.now, sub: t.status === 'review' ? 'Ready for review' : undefined, t, request: req }
  })
  for (const w of WORKSPACES) panesOf(w.id).forEach((k, i) => {
    if (!k.prov || (k.tag && S.tasks.some(t => t.title === k.tag))) return
    const st = PANE_STATE[paneTone(k)] || 'unknown'
    out.push({ id: 'p-' + k.id, kind: 'pane', ws: w, title: k.tag || `${k.prov === 'claude' ? 'Claude Code' : 'Codex'} in ${wsName(w)}`, prov: k.prov, state: st, since: 'since 14:31', pane: { ws: w.id, i } })
  })
  const api = WORKSPACES.find(w => w.id === 'w-api')!
  out.push({ id: 'd-147', kind: 'delegation', ws: api, title: 'Review the refund migration', prov: 'codex', state: 'working', since: 'for 3 min', parent: 't147' })
  if (S.agWorkOk) {
    out.push({ id: 'w-audit', kind: 'work', ws: WORKSPACES.find(w => w.id === 'w-infra')!, title: 'Nightly dependency audit', prov: 'codex', state: 'unknown', since: 'since 03:00' })
    out.push({ id: 'w-slow', kind: 'work', ws: api, title: 'Weekly report of slow queries', prov: 'claude', state: 'finished', since: 'since 08:12' })
  }
  return out
}
function open (a: Agent) {
  if (a.t) openTask(a.t.id)
  else if (a.pane) { S.ws = a.pane.ws; S.code.focus = a.pane.i; S.area = 'mode'; S.mode2 = 'code'; syncScreen(); emit() }
  else { S.overlay = { type: 'dlg', id: 'delegated' }; emit() }
}
/** Steer a conversation (it queues if the provider can't steer mid-turn); type into a pane (the person's own keys). */
export const canSteer = (t: Task) => t.prov === 'claude'
function steer (a: Agent) {
  const text = (S.agSteer?.[a.id] || '').trim(); if (!text) return
  if (a.t) { S.drafts[a.t.id] = text; sendMsg(a.t) } else toast(`Typed into the ${a.prov === 'claude' ? 'Claude Code' : 'Codex'} pane in ${wsName(a.ws)}`)
  S.agSteer![a.id] = ''; S.agOpen = undefined; emit()
}
function Steer ({ a }: { a: Agent }) {
  const ph = a.kind === 'pane' ? 'Type into the pane, as you would there' : a.state === 'working' ? (a.t && canSteer(a.t) ? 'Steer it: it reads this after the current step' : 'Queued until the current turn ends') : 'Tell it what to do next'
  return <form className="ag-steer" onSubmit={e => { e.preventDefault(); steer(a) }}><input className="input" autoFocus aria-label={`${a.kind === 'pane' ? 'Type into' : 'Tell ' + prov(a.prov).name + ' something on'} "${a.title}"`} placeholder={ph} value={S.agSteer?.[a.id] || ''} onChange={e => { (S.agSteer ||= {})[a.id] = e.target.value; emit() }} onKeyDown={e => { if (e.key === 'Escape') { S.agOpen = undefined; emit() } }} />
    <button className="btn sm pri" disabled={!(S.agSteer?.[a.id] || '').trim()}>Send <Kbd>Enter</Kbd></button></form>
}
/** A on the focused card: Allow when reversible; the impact preview (then hold A) when not. D: Deny. */
export function agoraKey (k: string): boolean {
  const card = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.ag-need'); const id = card?.dataset.ap; if (!id || S.resolved[id]) return false
  if (k === 'd') { resolve(id, 'deny'); emit(); refocus(); return true }
  if (k === 'a') { if (D.approvals[id].irreversible) S.overlay = { type: 'approve', id }; else { resolve(id, 'ok'); refocus() } emit(); return true }
  return false
}
function NeedsCard ({ a, first }: { a: Agent; first: boolean }) {
  const ap = a.request ? D.approvals[a.request] : null; const ref = useRef<HTMLElement>(null)
  useEffect(() => { if (first && !document.activeElement?.closest('.ag-need, .ag-h, input')) ref.current?.focus() }, [first])
  return <article ref={ref} className="ag-need" tabIndex={0} data-ap={ap?.id} data-ws={wsColor(a.ws)} aria-label={`${a.title} needs you${ap ? `: ${ap.title}. D to deny, A to ${ap.irreversible ? 'see the impact' : 'allow'}` : ''}`}>
    <header><span className="wschip"><span className="wsdot" />{wsName(a.ws)}</span><Av p={a.prov} /><button className="ag-t" onClick={() => open(a)}>{a.title}</button><span className="sp" /><span className="muted mono" style={{ fontSize: 11 }}>{a.since}</span></header>
    {ap ? <><p className="ag-ask"><b>{ap.title}</b> <span className="muted">· {ap.where}</span>{ap.irreversible ? <span className="pill danger" style={{ height: 18, marginLeft: 6 }}>can't be undone</span> : null}</p>
      <div className="ag-acts"><button className="btn sm" onClick={() => { resolve(ap.id, 'deny'); emit(); refocus() }}>Deny <Kbd>D</Kbd></button>
        {ap.irreversible ? <button className="btn sm pri" onClick={run(() => { S.overlay = { type: 'approve', id: ap.id } })}>See impact… <Kbd>A</Kbd></button> : <button className="btn sm pri" onClick={() => { resolve(ap.id, 'ok'); emit(); refocus() }}>Allow <Kbd>A</Kbd></button>}
        <span className="sp" /><button className="btn sm ghost" onClick={run(() => { S.agOpen = a.id })}>Tell it something else</button></div></>
      : <><p className="ag-ask"><b>{(a.activity || '').replace('Waiting for your answer: ', 'Asks you ')}</b></p><div className="ag-acts"><button className="btn sm pri" onClick={() => open(a)}>Answer in the conversation</button><span className="sp" /><button className="btn sm ghost" onClick={run(() => { S.agOpen = a.id })}>Tell it something else</button></div></>}
    {S.agOpen === a.id ? <Steer a={a} /> : null}</article>
}
const FILTERS: [string, string, (a: Agent) => boolean][] = [
  ['all', 'All', () => true], ['needs-you', 'Needs you', a => a.state === 'needs-you'], ['failed', 'Failed', a => a.state === 'failed'], ['working', 'Working', a => a.state === 'working'],
  ['finished', 'Finished', a => a.state === 'finished'], ['idle', 'Idle or stopped', a => a.state === 'idle' || a.state === 'stopped'], ['unknown', 'Not confirmed', a => a.state === 'unknown']]
function Row ({ a, all }: { a: Agent; all: Agent[] }) {
  const kids = all.filter(x => x.parent === a.id)
  return <><div role="listitem" className={'ag-row st-' + a.state + (a.parent ? ' nested' : '')}>
    <span className={'sg ' + GLYPH[a.state]} aria-hidden="true" /><Av p={a.prov} size="s16" /><button className="ag-t trunc" onClick={() => open(a)} title={`Open where it runs (${a.kind === 'pane' ? 'OxeCode pane' : a.kind === 'thread' ? 'OxeChat' : a.kind === 'delegation' ? 'Delegated work' : 'Work run'})`}>{a.title}</button>
    <span className="ag-src">{a.kind === 'pane' ? <><Icon n="term" s={12} />pane</> : a.kind === 'thread' ? <><Icon n="chat" s={12} />chat</> : a.kind === 'delegation' ? <><Icon n="layers" s={12} />delegated</> : <><Icon n="clock" s={12} />work</>}</span>
    <span className="ag-now trunc"><b>{STATE_WORD[a.state]}</b>{a.sub ? ` · ${a.sub}` : ''}{a.kind === 'thread' && a.activity && a.state !== 'finished' ? ` · ${a.activity.replace(/^Waiting for you: /, 'asks to ')}` : ''}{a.model ? <span className="muted"> · {a.model}</span> : null}{a.parent ? <span className="muted"> · delegated by {task(a.parent)?.title}</span> : null}</span>
    <span className="mono muted ag-since">{a.since}</span>
    <span className="ag-ra">{(a.kind === 'thread' && a.state !== 'finished') || (a.kind === 'pane' && a.state !== 'stopped') ? <button className="btn sm" onClick={run(() => { S.agOpen = S.agOpen === a.id ? undefined : a.id })} aria-expanded={S.agOpen === a.id}>{a.kind === 'pane' ? 'Type' : 'Steer'}</button> : null}
      {a.kind === 'thread' && a.state === 'working' ? <button className="btn sm" onClick={run(() => { S.agStop = a.id; S.overlay = { type: 'dlg', id: 'agstop' } })}><Icon n="stop" s={12} />Stop</button> : null}
      <button className="ibtn sm" aria-label={`Open ${a.title}`} title="Open" onClick={() => open(a)}><Icon n="ext" s={12} /></button></span>
    {S.agOpen === a.id && a.state !== 'needs-you' ? <div className="ag-sx"><Steer a={a} /></div> : null}</div>
    {kids.map(k => <Row key={k.id} a={k} all={all} />)}</>
}
export function Agora () {
  const all = agents(); const f = S.agFilter || 'all'; const fl = FILTERS.find(x => x[0] === f) || FILTERS[0]
  const needs = all.filter(a => a.state === 'needs-you' && a.kind === 'thread')
  const groups = WORKSPACES.filter(w => !S.wsGone?.includes(w.id)).map(w => [w, all.filter(a => a.ws.id === w.id && fl[2](a))] as const).filter(g => g[1].length)
  return <div className="agora">
    <header className="ag-h"><div><h1>Agora</h1><p>Every agent in every workspace, right now. Act here or open it where it runs.</p></div><span className="sp" />
      <div className="seg" role="radiogroup" aria-label="Show">{FILTERS.map(([k, l, m]) => <button key={k} role="radio" aria-checked={f === k} onClick={run(() => { S.agFilter = k })}>{l}<span className="n">{all.filter(m).length}</span></button>)}</div></header>
    <div className="ag-body scroll">
      {!S.agWorkOk ? <div className="callout info" role="status"><Icon n="info" /><span>Some agents couldn't be read right now. The rest is up to date.</span><span className="sp" /><button className="btn sm" onClick={run(() => { S.agWorkOk = true; toast('Work runs read again') })}>Try again</button></div> : null}
      {f === 'all' || f === 'needs-you' ? needs.length
        ? <section className="ag-needs" aria-labelledby="ag-needs-h"><h2 id="ag-needs-h"><span className="sun" />Needs you <span className="n">{needs.length}</span><span className="muted ag-keys"><Kbd>D</Kbd> deny · <Kbd>A</Kbd> allow or see the impact, on the focused card</span></h2><div className="ag-ngrid">{needs.map((a, i) => <NeedsCard key={a.id} a={a} first={i === 0} />)}</div></section>
        : <section className="ag-needs"><h2 className="ag-needs-none" tabIndex={-1}><Icon n="check" s={12} />Nothing needs you</h2></section> : null}
      {groups.map(([w, list]) => { const shut = S.agShut?.[w.id]; const top = list.filter(a => !a.parent || !list.some(p => p.id === a.parent)); const done = top.filter(a => a.state === 'finished'); const live = top.filter(a => a.state !== 'finished'); const showDone = f !== 'all' || S.agDone?.[w.id]
        return <section key={w.id} className="ag-ws" data-ws={wsColor(w)} aria-label={wsName(w)}>
          <h2><button aria-expanded={!shut} onClick={run(() => { (S.agShut ||= {})[w.id] = !shut })}><Icon n={shut ? 'right' : 'down'} s={12} /><span className="wsdot" /><span>{wsName(w)}</span><span className="mono muted">{w.wt ? 'worktree · ' : ''}{w.branch}</span><span className="n">{plural(list.length, 'agent')}</span></button></h2>
          {shut ? null : <><div className="ag-rows" role="list">{(showDone ? top : live).map(a => <Row key={a.id} a={a} all={list} />)}</div>
            {!showDone && done.length ? <button className="more-b" onClick={run(() => { (S.agDone ||= {})[w.id] = true })}>Show {plural(done.length, 'finished agent')}</button> : null}</>}</section> })}
      {!groups.length ? <div className="state" style={{ padding: 40 }}><p>No agents match this filter.</p></div> : null}
    </div>
    <footer className="ag-f muted"><span>The agents read model (S7.1), in the phone's words. Requests from MCP never show Allow here: they wait in their conversation.</span><span className="sp" /><span><Kbd>Ctrl Shift G</Kbd> opens Agora</span></footer></div>
}
export const agoraBadge = () => needsN()
export function stopAgent () { const a = agents().find(x => x.id === S.agStop); if (!a) return; if (a.t) { a.t.status = 'idle'; a.t.now = 'Stopped by you. The work so far is kept.' } toast(`Stopped "${a.title}"`) }
