/* Screens that need the full Task entity (later, full B). Shown so the user can compare; not in 1.5.0. */
import { D } from '../mock/data'
import { S, run, plural } from '../state/store'
import { Icon, Av } from './ui'
import { TaskView, ToolRowView, openTask } from './Task'

const TK: Record<string, string> = { read: 'read', edit: 'edit', run: 'run', fail: 'fail', done: '' }
export function Later () {
  const band = (t: string) => <div className="later-band"><Icon n="info" s={12} />{t}</div>
  if (S.area === 'later-multi') return <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0,1fr)', minHeight: 0 }}>{band('Later (full B): one task owns several conversations, here Codex on the report and Claude on the data fix. Needs the Task entity and an Android protocol change.')}<TaskView /></div>
  const ts = S.tasks.filter(t => ['run', 'needs'].includes(t.status)).slice(0, 3)
  return <div style={{ display: 'grid', gridTemplateRows: 'auto auto minmax(0,1fr)', minHeight: 0, background: 'var(--surface-base)' }}>
    {band('Later (full B): one live board of every running task. 1.5.0 has the task list and notifications instead.')}
    <div className="pane-h" style={{ padding: '10px 16px' }}><span style={{ color: 'var(--k-db)' }}><Icon n="grid" s={16} /></span><h3 style={{ font: '700 16px var(--f-display)' }}>Watch running tasks</h3><span className="muted" style={{ fontSize: 12 }}>{plural(ts.length, 'task')}</span></div>
    <div className="board">{ts.map(t => <div key={t.id} className={'bcol' + (t.status === 'needs' ? ' needs' : '')}>
      <div className="bcol-h"><div className="row"><Av p={t.prov} /><span className="mono muted" style={{ fontSize: 11 }}>{t.key}</span><span className="sp" />{t.status === 'needs' ? <span className="pill needs"><span className="sun live" />Needs you</span> : <span className="pill run"><span className="dot pulse" />Running</span>}</div><div className="tt">{t.title}</div></div>
      <div className="s">{(S.conv[t.id] || []).filter(x => x.tools).flatMap(x => x.tools!).slice(-8).map((r, i) => <ToolRowView key={i} r={r} k={'w' + i} still />)}</div>
      <div className="f row">{t.status === 'needs' && t.gate ? <button className="btn sm pri" onClick={run(() => { S.overlay = { type: 'approve', id: t.gate! } })}>See impact</button> : null}<span className="sp" /><button className="btn sm" onClick={() => openTask(t.id)}>Open</button></div></div>)}</div></div>
}
export { D, TK }
