/* The task's tools (lite B: built from the conversation's agent activity) and the shared impact preview. */
import { Fragment } from 'react'
import { D } from '../mock/data'
import type { Task, Term, Query, Req, FileChange, Approval } from '../mock/types'
import { PLACES, type Place } from '../mock/locations'
import { S, emit, run, task, prov, plural, toast, resolve, raisePush } from '../state/store'
import { Icon, Av, Kbd, MI, menuBtn, StateBlock, toastSoon } from './ui'
import { MENUS, railGo } from './Shell'
import { syncScreen, goScreen } from '../screens/registry'

/* ---------------------------------------------------------------- shared pieces */
const KW = /\b(UPDATE|SET|FROM|WHERE|AND|SELECT|JOIN|ON|LIMIT|GROUP BY|EXPLAIN|ANALYZE|CREATE|TABLE|INDEX|CONCURRENTLY|PRIMARY|KEY|NOT|NULL|DEFAULT|IS|IN|AS|ANY|count|now)\b/
export function Highlight ({ s, lang }: { s: string; lang?: string }) {
  if (lang === 'shell') return <>{s.split('\n').map((l, i) => <Fragment key={i}>{l.startsWith('#') ? <span className="cm">{l}</span> : l}{'\n'}</Fragment>)}</>
  const parts = s.split(/(\b(?:UPDATE|SET|FROM|WHERE|AND|SELECT|JOIN|ON|LIMIT|GROUP BY|EXPLAIN|ANALYZE|CREATE|TABLE|INDEX|CONCURRENTLY|PRIMARY|KEY|NOT|NULL|DEFAULT|IS|IN|AS|ANY|count|now)\b|'[^']*')/g)
  return <>{parts.map((p, i) => KW.test(p) && /^[A-Za-z ]+$/.test(p) ? <span key={i} className="kw">{p}</span> : p.startsWith('\'') ? <span key={i} className="str">{p}</span> : p)}</>
}
export const EnvPill = ({ e }: { e: string }) => <span className={'env ' + e}>{e}</span>
export const AccPill = ({ a }: { a: string }) => <span className={'acc ' + a} title="What agents may do here">{({ off: 'Agents off', read: 'Agents read', confirm: 'Agents ask first', write: 'Agents write' } as Record<string, string>)[a]}</span>
export const Status = ({ s }: { s: number }) => <span className={'st s' + String(s)[0]}>{s || '—'}</span>
export function TermView ({ k, live }: { k: Term; live?: boolean }) {
  return <div className="term" ref={el => { if (el) el.scrollTop = el.scrollHeight }}>{k.lines.map(([c, s], i) => c === '$ ' ? <div key={i}><span className="p">{k.cwd.split('/').pop()} $</span> {s}</div> : <div key={i} className={c}>{s || ' '}</div>)}{live ? <div><span className="p">$</span> <span className="cur" /></div> : null}</div>
}
export const PaneHead = ({ k, tag }: { k: Term; tag?: string }) => <div className="th-pane"><Icon n="term" s={12} /><b>{k.name}</b><span className="mono">{k.cwd}</span>{k.by === 'agent' ? <span className="pill run" style={{ height: 18 }}>agent</span> : null}{tag ? <span className="pill neutral" style={{ height: 18 }}>{tag}</span> : null}<span className="sp" /><button className="ibtn sm" onClick={menuBtn('pane')} aria-label="Pane actions"><Icon n="more" s={12} /></button></div>
MENUS.pane = () => <><MI icon="ext" label="Open in OxeCode" onClick={() => railGo('code')} /><MI icon="copy" label="Copy output" onClick={() => toast('Copied the output')} /><hr /><div className="mg">Output savers</div>
  <MI check label="RTK" hint="Compress command output" /><MI check={false} label="Caveman" hint="Shorter agent replies" /><MI check label="Semantic" hint="Search code by meaning" /><hr /><MI icon="x" dz label="Close terminal" onClick={() => toast('Closed the terminal. Its process got SIGHUP.')} /></>
export function DiffFile ({ f }: { f: FileChange }) {
  return <div className="cfile"><div className="cfile-h"><Icon n="file" s={12} /><span className="trunc">{f.path}</span>{f.isNew ? <span className="pill done" style={{ height: 18 }}>new</span> : null}<span className="sp" /><span className="a">+{f.add}</span><span className="d">−{f.del}</span><span className="hunk-acts"><button className="btn sm" onClick={run(() => toast(`Undid every change in ${f.path}`, { undo: () => {} }))}>Undo file</button></span></div>
    <div className="hunk-h"><span className="mono">@@ {f.isNew ? '-0,0 +1,' + f.add : '-41,' + f.del + ' +41,' + f.add} @@</span><span className="sp" /><button className="btn sm" onClick={run(() => toast('Undid this hunk', { undo: () => {} }))}>Undo hunk</button><button className="btn sm" onClick={run(() => { (S.hunkNote ||= {})[f.path] = S.hunkNote[f.path] ?? '' })}>Comment</button></div>
    <div className="dl2">{f.hunks.map(([k, s], i) => <div key={i} className={'ln ln-' + k}>{s}</div>)}</div>
    {S.hunkNote?.[f.path] != null ? <div className="hunk-c"><textarea className="input" rows={2} aria-label={`Comment on this hunk of ${f.path}`} placeholder="Tell the agent what to change here" value={S.hunkNote[f.path]} onChange={e => { S.hunkNote![f.path] = e.target.value; emit() }} /><div className="row"><span className="sp" /><button className="btn sm" onClick={run(() => { delete S.hunkNote![f.path] })}>Cancel</button><button className="btn sm pri" disabled={!S.hunkNote[f.path].trim()} onClick={run(() => { delete S.hunkNote![f.path]; toast('Sent to the agent with the hunk attached') })}>Send to the agent</button></div></div> : null}</div>
}
const Grid = ({ cols, rows }: { cols: string[]; rows: string[][] }) => <div className="tbl-wrap"><table className="grid-t"><thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div>
const ms = (n: number) => n > 999 ? (n / 1000).toFixed(1) + ' s' : n + ' ms'

/* ---------------------------------------------------------------- tool tabs inside a task */
export function ToolTab ({ t, tab }: { t: Task; tab: string }) {
  if (tab === 'terminal') {
    const ks = D.terms[t.id] || []
    if (!ks.length) return <StateBlock kind="empty" icon="term" title="No terminals yet" text="Terminals the agent opens in this task's worktree show up here. You can open your own too."><button className="btn" onClick={() => toastSoon('A terminal opens in the task\'s worktree.')}><Icon n="plus" s={12} />New terminal</button></StateBlock>
    return <div className="panes" style={{ gridTemplateColumns: `repeat(${ks.length}, minmax(0,1fr))` }}>{ks.map((k, i) => <div key={k.id} className={i === 0 ? 'focus' : ''}><PaneHead k={k} /><TermView k={k} live={k.by === 'you' || t.status === 'run'} /></div>)}</div>
  }
  if (tab === 'queries') {
    const qs = D.queries.filter(q => q.task === t.id)
    if (!qs.length) return <StateBlock kind="empty" icon="db" title="No queries" text="This task didn't query a database. Agent access is set per connection in OxeQuery."><button className="btn" onClick={() => railGo('query')}>Open OxeQuery</button></StateBlock>
    const sel = qs.find(q => q.id === S.q.sel) || qs[0]
    return <div className="split2"><div className="scroll"><div className="lst">{qs.map(q => { const conn = D.connections.find(c => c.id === q.conn)!; const pending = q.status === 'pending' && !S.resolved.ap_sql
      return <button key={q.id} className="li" onClick={run(() => { S.q.sel = q.id })} aria-current={q.id === sel.id}><span className="mono">{q.sql.split('\n')[0]}</span><span className="m-time">{q.at.slice(0, 5)}</span>
        <span className="sub"><EnvPill e={conn.env} />{q.conn} · {pending ? <span style={{ color: 'var(--attn-fg)' }}>waiting for you</span> : q.status === 'pending' ? (S.resolved.ap_sql === 'deny' ? 'denied by you' : '1,284 rows · 3.4 s') : q.status === 'denied' ? <span style={{ color: 'var(--danger-fg)' }}>denied</span> : `${plural(q.rows, 'row')} · ${ms(q.ms)}`}</span></button> })}</div></div>
      <QueryDetail q={sel} inTask /></div>
  }
  if (tab === 'requests') {
    const rs = Object.values(D.requests).filter(r => r.task === t.id)
    if (!rs.length) return <StateBlock kind="empty" icon="net" title="No requests" text="This task didn't send HTTP requests. Agent access is set per collection in OxePost."><button className="btn" onClick={() => railGo('post')}>Open OxePost</button></StateBlock>
    const sel = rs.find(r => r.id === S.post.req) || rs[0]
    return <div className="split2"><div className="scroll"><div className="lst">{rs.map(r => <button key={r.id} className="li" onClick={run(() => { S.post.req = r.id })} aria-current={r.id === sel.id}><span className="row" style={{ gap: 6, minWidth: 0 }}><span className={'meth ' + r.method}>{r.method}</span><span className="trunc">{r.name}</span></span>{r.blocked ? <span className="pill err" style={{ height: 18 }}>blocked</span> : <Status s={r.status} />}
      <span className="sub"><EnvPill e={r.env === 'prod' ? 'production' : r.env} />{r.at} · {r.ms ? r.ms + ' ms' : 'not sent'}</span></button>)}</div></div><ReqDetail r={sel} inTask /></div>
  }
  if (tab === 'containers') {
    const cs = D.containers.filter(c => c.task === t.id)
    if (!cs.length) return <StateBlock kind="empty" icon="box" title="No containers" text="This task didn't start or touch containers."><button className="btn" onClick={() => railGo('pod')}>Open OxePod</button></StateBlock>
    const sel = cs.find(c => c.id === S.pod.sel) || cs[0]
    return <div className="pane" style={{ gridTemplateRows: 'auto minmax(0,1fr)' }}><div className="scroll" style={{ maxHeight: 220 }}><table className="ctable"><thead><tr><th /><th>Name</th><th>Image</th><th>Status</th><th>Ports</th><th>CPU</th><th>Memory</th><th /></tr></thead>
      <tbody>{cs.map(c => <tr key={c.id} className="click" onClick={run(() => { S.pod.sel = c.id })} aria-selected={c.id === sel.id}><td><span className={'sdot ' + (c.status === 'running' ? 'on' : 'bad')} /></td><td><b>{c.name}</b></td><td className="mono">{c.image}</td><td>{c.status === 'running' ? 'Up ' + c.up : c.up}</td><td className="mono">{c.ports}</td><td className="mono">{c.cpu}</td><td className="mono">{c.mem}</td>
        <td><button className="btn sm ghost" onClick={e => { e.stopPropagation(); toast(`Restarted ${c.name}`); emit() }}><Icon n="restart" s={12} />Restart</button></td></tr>)}</tbody></table></div>
      <div className="pane"><div className="pane-h"><Icon n="log" s={12} /><h3>Logs · {sel.name}</h3><span className="sp" /><button className="btn sm" onClick={() => { S.pod.sel = sel.id; railGo('pod') }}>Open in OxePod</button></div>
        <TermView k={{ id: 'lg', name: '', shell: '', cwd: '', by: '', lines: (D.logs[sel.id] || D.logs.api).map(l => [/error|FATAL/.test(l) ? 'err' : /warn|DETAIL/.test(l) ? 'dim' : '', l]) }} live={sel.status === 'running'} /></div></div>
  }
  if (tab === 'changes') return <ChangesTab t={t} />
  return <PrTab t={t} />
}

function PrTab ({ t }: { t: Task }) {
  const pr = t.pr ? D.prs[t.pr] : null
  if (pr) return <div className="scroll"><div className="detail" style={{ maxWidth: 860, padding: '18px 20px' }}>
    <div className="row"><Icon n="pr" s={16} /><h3>{pr.title} <span className="muted">#{pr.n}</span></h3></div>
    <div className="row" style={{ fontSize: 12, flexWrap: 'wrap' }}><span className={'pill ' + (pr.state === 'merged' ? 'done' : 'run')}>{pr.state === 'merged' ? 'Merged' : 'Open'}</span><span className="mono">{pr.head}</span><Icon n="right" s={12} /><span className="mono">{pr.base}</span><span className="muted">{plural(pr.commits, 'commit')} · {plural(pr.files, 'file')} · <span style={{ color: 'var(--success-fg)' }}>+{pr.add}</span> <span style={{ color: 'var(--danger-fg)' }}>−{pr.del}</span></span></div>
    <div className="ssec"><div className="ssec-h"><h2>Checks</h2><span className="muted" style={{ fontSize: 12 }}>{pr.checks.filter(c => c[1] === 'pass').length} of {pr.checks.length} passed</span></div>{pr.checks.map(([n, s, d]) => <div key={n} className="srow" style={{ padding: '8px 16px' }}><div className="row">{s === 'pass' ? <span style={{ color: 'var(--success)' }}><Icon n="check" /></span> : <span className="spin" />}<span>{n}</span></div><span className="num muted">{d}</span></div>)}</div>
    <div className="ssec"><div className="ssec-h"><h2>Reviewers</h2></div>{pr.reviewers.map(([n, s]) => <div key={n} className="srow" style={{ padding: '8px 16px' }}><span>{n}</span><span className={'pill ' + (s === 'approved' ? 'done' : 'neutral')}>{s === 'approved' ? 'Approved' : 'Review requested'}</span></div>)}</div>
    {pr.body ? <div><div className="slabel" style={{ marginBottom: 6 }}>Description</div><pre className="code" style={{ fontFamily: 'var(--f-ui)', fontSize: 13 }}>{pr.body}</pre></div> : null}
    <div className="row"><button className="btn" onClick={() => toastSoon(`Opens github.com/cajui/${D.projects[t.project].name}/pull/${pr.n} in your browser.`)}><Icon n="ext" s={12} />Open on GitHub</button><button className="btn" onClick={() => toastSoon('The agent reads the review comments and answers in the conversation.')}>Address review comments</button><span className="sp" />{pr.state !== 'merged' ? <button className="btn pri" disabled title="Merging happens on GitHub after review">Merge</button> : null}</div></div></div>
  const busy = t.status === 'run' || t.status === 'needs'; const fs = D.changes[t.id] || []
  return <div className="scroll"><div className="detail" style={{ maxWidth: 760, padding: '18px 20px' }}>
    <h3>Open a pull request</h3><p className="muted">The branch is pushed to origin first. That push asks for your approval.</p>
    {busy ? <div className="callout info"><Icon n="info" /><span>{prov(t.prov).name} is still working. Wait for it to finish, or stop it first, so the pull request has every change.</span></div> : null}
    <div className="field"><label htmlFor="pr-title">Title</label><input className="input" id="pr-title" defaultValue={t.title} /></div>
    <div className="row"><div className="field" style={{ flex: 1 }}><label>From</label><div className="input mono" style={{ fontSize: 12 }}>{t.branch}</div></div><div className="field" style={{ width: 180 }}><label htmlFor="pr-base">Into</label><select className="sel" id="pr-base" style={{ width: '100%' }}><option>main</option><option>release/2026.11</option></select></div></div>
    <div className="field"><label htmlFor="pr-body">Description <span className="muted" style={{ fontWeight: 400 }}>· written by the agent from the conversation</span></label>
      <textarea className="input" id="pr-body" rows={7} defaultValue={`${t.title}.\n\n- ${plural(fs.length, 'file')} changed in ${t.branch}\n- Tests run by the agent in the task's worktree\n- See the task's conversation for the reasoning`} /></div>
    <label className="row" style={{ fontSize: 13 }}><input type="checkbox" id="pr-draft" /> Open as a draft</label>
    <div className="row"><span className="sp" /><button className="btn pri" disabled={busy && t.id !== 't142'} title={busy && t.id !== 't142' ? 'Wait for the agent to finish' : undefined} onClick={run(() => { if (t.id === 't142') { raisePush(); S.overlay = { type: 'approve', id: 'ap_push' } } else toast('Pushed and opened (simulated for this task)') })}><Icon n="pr" s={12} />Push and open pull request</button></div></div></div>
}

export function QueryDetail ({ q, inTask }: { q: Query; inTask?: boolean }) {
  const conn = D.connections.find(c => c.id === q.conn)!
  const pending = q.status === 'pending' && !S.resolved.ap_sql
  return <div className="scroll"><div className="detail"><div className="row"><span className="kchip db"><Icon n="db" s={12} />{conn.name}</span><EnvPill e={conn.env} /><span className="m-time">{q.at}</span><span className="sp" />
    {inTask ? <button className="btn sm" onClick={() => { S.q.tab = 'activity'; S.q.act = q.id; railGo('query') }}>Open in OxeQuery</button> : null}</div>
    <pre className="code"><Highlight s={q.sql} /></pre>
    {pending ? <div className="callout" style={{ background: 'var(--attn-bg)', borderColor: 'var(--attn-border)', color: 'var(--attn-fg)' }}><Icon n="shield" /><span>This write is waiting for your approval. It would change {q.rows.toLocaleString('en')} rows.</span><span className="sp" /><button className="btn sm pri" onClick={run(() => { S.overlay = { type: 'approve', id: 'ap_sql' } })}>See impact</button></div>
      : q.status === 'denied' ? <div className="callout danger"><Icon n="lock" /><span>Not run. {q.note}</span></div>
        : q.status === 'pending' ? <div className="callout ok"><Icon n="check" /><span>{S.resolved.ap_sql === 'deny' ? 'You denied this write. It never ran.' : 'Ran after your approval: 1,284 rows changed in 3.4 s.'}</span></div>
          : <><div className="row" style={{ fontSize: 12, color: 'var(--text-muted)' }}><span>{plural(q.rows, 'row')}</span><span>·</span><span className="num">{ms(q.ms)}</span><span>·</span><span>{q.kind === 'read' ? 'Read' : q.kind === 'ddl' ? 'Schema change' : 'Write'}</span></div>{q.cols.length ? <Grid cols={q.cols} rows={q.data} /> : <p className="muted">No rows returned.</p>}</>}</div></div>
}
export function ReqDetail ({ r, inTask }: { r: Req; inTask?: boolean }) {
  const url = r.url.replace('{{base_url}}', (D.envs.find(e => e.id === r.env) || D.envs[0]).vars[0][1])
  const secret = (v: string) => { const m = v.match(/^(.*?)(•••• \([A-Z_]+\))(.*)$/); return m ? <>{m[1]}<span className="code" style={{ display: 'inline', padding: '0 4px', border: 0, background: 'var(--attn-bg)', color: 'var(--attn-fg)' }}>{m[2]}</span>{m[3]}</> : v }
  return <div className="scroll"><div className="detail"><div className="urlbar"><span className={'m meth ' + r.method} style={{ display: 'grid', placeItems: 'center', borderRadius: 0 }}>{r.method}</span><input value={url} readOnly aria-label="URL" /></div>
    {r.blocked ? <div className="callout danger"><Icon n="shield" /><span><b>Blocked by policy.</b> api.cajui.com.br is a production host. This workspace lets agents call the sandbox and localhost only.</span></div>
      : <div className="row" style={{ fontSize: 12 }}><Status s={r.status} /><span className="num muted">{r.ms} ms · {r.size}</span><span className="m-time">{r.at || ''}</span><span className="sp" />{inTask ? <button className="btn sm" onClick={() => { S.post.req = r.id; S.post.newReq = null; S.post.activity = false; const c = D.collections.find(c => c.reqs.includes(r.id)); if (c) S.post.col = c.id; railGo('post') }}>Open in OxePost</button> : null}</div>}
    {r.headers.length ? <div><div className="slabel" style={{ marginBottom: 4 }}>Request headers</div><dl className="kv">{r.headers.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{secret(v)}</dd></Fragment>)}</dl></div> : null}
    {r.reqBody ? <div><div className="slabel" style={{ marginBottom: 4 }}>Request body</div><pre className="code">{r.reqBody}</pre></div> : null}
    {r.resBody ? <div><div className="slabel" style={{ marginBottom: 4 }}>Response</div><pre className="code">{r.resBody}</pre></div> : null}</div></div>
}

/* ---------------------------------------------------------------- impact preview: dialog and queue share it */
export function ImpactBody ({ ap }: { ap: Approval }) {
  const t = task(ap.task)!; const isDb = ap.kind === 'db'
  return <div className="imp">
    <div className="imp-h"><Av p={t.prov} size="lg" /><div style={{ minWidth: 0 }}><h3>{ap.title}</h3><p>{prov(t.prov).name} · {t.title}</p></div></div>
    <p style={{ color: 'var(--text-secondary)' }}>{ap.why}</p>
    <div className="imp-facts"><div><small>Where it runs</small><strong>{ap.where}</strong><small>{ap.whereSub}</small></div><div><small>Affects</small><strong>{ap.rows}</strong><small>{ap.rowsSub}</small></div>
      <div><small>Can it be undone?</small><strong className={ap.irreversible ? 'irrev' : 'rev'}>{ap.irreversible ? 'No' : 'Yes'}</strong><small>{ap.undoSub}</small></div><div><small>Risk</small><strong>{{ high: 'High', medium: 'Medium', low: 'Low' }[ap.risk]}</strong><small>{ap.risk === 'high' ? 'Writes shared data' : ap.risk === 'medium' ? 'Deletes local data' : 'Reversible, remote'}</small></div></div>
    {isDb && ap.cols && ap.sample ? <div><div className="slabel" style={{ marginBottom: 6 }}>Before → after <span className="n">sample of 5 of {ap.rows} rows</span></div><div className="tbl-wrap"><table className="grid-t"><thead><tr>{ap.cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{ap.sample.map((r, i) => <tr key={i}>{r.map((v, j) => Array.isArray(v) ? <td key={j} className="chg"><s>{v[0]}</s>{v[1]}</td> : <td key={j}>{v}</td>)}</tr>)}</tbody></table></div></div> : null}
    <div><div className="slabel" style={{ marginBottom: 6 }}>{isDb ? 'SQL' : 'Command'} <span className="n">exactly what runs</span></div><pre className="code"><Highlight s={ap.sql} lang={ap.lang} /></pre></div>
    {ap.irreversible ? <div className="callout danger"><Icon n="warn" /><span><b>This can't be undone.</b> {ap.snapshot ? 'Take a snapshot first, or hold Approve for 1.2 s.' : 'Hold Approve for 1.2 s to confirm.'}</span></div> : <div className="callout ok"><Icon n="undo" /><span>{ap.undoSub} if you change your mind.</span></div>}
    {ap.snapshot ? <div className="callout info"><Icon n="db" /><span><b>Snapshot, then approve:</b> {ap.snapshot}</span></div> : null}
    <p className="phone-note"><Icon n="phone" s={12} />{ap.kind === 'db' ? 'Database writes are answered only at this computer; the phone shows "answer on the computer".' : ap.irreversible ? 'On the phone this is Critical: Allow unlocks after 2 s, then a fingerprint.' : 'On the phone: Allow after a fingerprint.'}</p></div>
}
/** Hold-to-confirm: pointer or the A key, 1.2 s. Releasing early cancels. */
let holdTimer: ReturnType<typeof setTimeout> | null = null
export function startHold (id: string) { if (S.holding === id) return; S.holding = id; emit(); holdTimer = setTimeout(() => { holdTimer = null; resolve(id, 'ok'); emit() }, 1200) }
export function cancelHold () { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; S.holding = null; emit() } }
export function ImpactActions ({ ap }: { ap: Approval }) {
  return <>{ap.snapshot ? <button className="btn" onClick={run(() => resolve(ap.id, 'snap'))}><Icon n="db" s={12} />Snapshot, then approve <Kbd>S</Kbd></button> : null}<span className="sp" />
    <button className="btn" data-autofocus onClick={run(() => resolve(ap.id, 'deny'))}>Deny <Kbd>D</Kbd></button>
    {ap.irreversible ? <button className={'btn dng hold' + (S.holding === ap.id ? ' holding' : '')} aria-label="Hold to approve" onPointerDown={() => startHold(ap.id)} onPointerUp={cancelHold} onPointerLeave={cancelHold}
      onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startHold(ap.id) } }} onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') cancelHold() }}>
      <i className="fillbar" /><span>{S.holding === ap.id ? 'Keep holding…' : 'Hold to approve'} <kbd className="k" style={{ background: 'transparent', color: 'inherit', borderColor: 'currentColor' }}>A</kbd></span></button>
      : <button className="btn pri" onClick={run(() => resolve(ap.id, 'ok'))}>Approve <kbd className="k">A</kbd></button>}
    {ap.irreversible ? <button className="btn ghost sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'irrev', text: ap.id } })}>Approve without holding…</button> : null}</>
}

export function QueueView () {
  const pend = S.queue.filter(q => !S.resolved[q]); const done = Object.keys(S.resolved)
  const sel = pend[Math.min(S.queueSel, pend.length - 1)]
  return <div className="qv"><div className="qv-l"><header><h1>Approvals</h1><p className="muted" style={{ fontSize: 12 }}>{pend.length ? `${plural(pend.length, 'request')} waiting · J and K move · D denies` : 'Nothing is waiting for you.'}</p></header>
    <div className="scroll"><div className="lst">{S.tasks.filter(t => t.ask).map(t => <button key={'q' + t.id} className="qi" onClick={() => { S.taskId = t.id; S.tab = 'conv'; goScreen('task-current'); setTimeout(() => document.getElementById('ask-' + t.id)?.scrollIntoView({ block: 'center' }), 100) }}><span className="sun live" style={{ marginTop: 5 }} /><span className="t trunc">{t.ask === 'cmd' ? 'Run a command' : 'Answer 2 questions'}</span><span className="s"><Av p={t.prov} size="s16" /><span className="trunc">{t.title}</span> · opens the conversation</span></button>)}
      {pend.map((q, i) => { const ap = D.approvals[q], t = task(ap.task)!
      return <button key={q} className="qi" autoFocus={i === 0 && q === sel} onClick={run(() => { S.queueSel = i })} aria-current={q === sel}><span className="sun live" style={{ marginTop: 5 }} /><span className="t trunc">{ap.title}</span><span className="s"><Av p={t.prov} size="s16" /><span className="trunc">{t.title}</span> · {ap.irreversible ? <span style={{ color: 'var(--danger-fg)' }}>can't be undone</span> : 'can be undone'}</span></button> })}
      {done.length ? <><div className="tg">Decided today</div>{done.map(q => <div key={q} className="qi" style={{ opacity: .75 }}><span style={{ color: S.resolved[q] === 'deny' ? 'var(--danger)' : 'var(--success)' }}><Icon n={S.resolved[q] === 'deny' ? 'x' : 'check'} s={12} /></span><span className="t trunc" style={{ fontWeight: 500 }}>{D.approvals[q].title}</span><span className="s">{S.resolved[q] === 'deny' ? 'Denied' : S.resolved[q] === 'snap' ? 'Snapshot, then approved' : 'Approved'} by you</span></div>)}</> : null}</div></div>
    <div className="dlg-f"><button className="btn sm ghost" onClick={() => goScreen('settings-approvals')}><Icon n="gear" s={12} />Approval rules</button></div></div>
    <div className="qv-r">{sel ? <><ImpactBody ap={D.approvals[sel]} /><div className="imp-act" style={{ marginTop: 16, maxWidth: 880 }}><ImpactActions ap={D.approvals[sel]} /></div>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}><button className="lk" onClick={() => { S.taskId = D.approvals[sel].task; S.tab = 'conv'; goScreen('task-current') }}>Open the task</button> to see the conversation around it.</p></>
      : <StateBlock kind="empty" icon="check" title="All clear" text="When an agent asks to do something outside its permissions, it waits here and on its task. Your phone gets it too when it's paired and on the same Wi-Fi; database writes are answered only here." />}</div></div>
}
export { syncScreen }

/** Changes, grouped by where they happened. Each checkout is compared with the commit the task started from, so a
    terminal that switches the branch doesn't make the task's work disappear. Folders outside any repository are
    listed as written. */
export function placesFor (t: Task): Place[] {
  const ps = PLACES[t.id]
  const wt: Place = { id: 'w', kind: t.worktree ? 'worktree' : 'main', path: t.worktree ? `~/.oxespace/worktrees/${D.projects[t.project].name}/${t.id}` : D.projects[t.project].path, branch: t.branch, base: '9bb5339', head: `${t.branch} @ 5c0e9b1`, files: [] }
  return (ps || [wt]).map(pl => pl.kind === 'outside' || pl.kind === 'checkout' ? pl : Object.assign({}, pl, { files: D.changes[t.id] || [] }))
}
function ChangesTab ({ t }: { t: Task }) {
  const places = placesFor(t).filter(p => p.files.length)
  if (!places.length) return <StateBlock kind="empty" icon="diff" title="No changes" text="Files the agent writes show up here, grouped by where it wrote them: its worktree, another checkout, or a folder outside the repository." />
  const all = places.flatMap(p => p.files); const add = all.reduce((n, f) => n + f.add, 0), del = all.reduce((n, f) => n + f.del, 0)
  const byTurn = S.changesView === 'turn'
  return <div className="pane"><div className="pane-h"><div className="segc" role="group" aria-label="Review"><button aria-pressed={!byTurn} onClick={run(() => { S.changesView = 'all' })}>All changes</button><button aria-pressed={byTurn} onClick={run(() => { S.changesView = 'turn' })}>By turn</button></div><h3>{plural(all.length, 'file')} changed</h3><span className="num" style={{ color: 'var(--success-fg)' }}>+{add}</span><span className="num" style={{ color: 'var(--danger-fg)' }}>−{del}</span><span className="muted">{places.length > 1 ? `in ${places.length} places` : ''}</span><span className="sp" />
    <button className="btn sm" onClick={run(() => toast('Asked the agent to review its own changes'))}>Ask for a review</button><button className="btn sm pri" onClick={run(() => { S.overlay = { type: 'dlg', id: 'finish' } })}>Finish the worktree…</button></div>
    <div className="scroll"><div className="stack" style={{ padding: '12px 16px', gap: 16 }}>{byTurn ? <TurnReview t={t} /> : null}{byTurn ? null : places.map(pl => <section key={pl.id} className="place">
      <header className="place-h"><span className={'place-k ' + pl.kind}><Icon n={pl.kind === 'outside' ? 'folder' : pl.kind === 'checkout' ? 'layers' : 'branch'} s={12} />{pl.kind === 'worktree' ? 'Task worktree' : pl.kind === 'main' ? 'Main checkout' : pl.kind === 'checkout' ? 'Another checkout' : 'Outside the repository'}</span>
        {pl.branch ? <span className="mono">{pl.branch}</span> : null}<span className="mono muted trunc">{pl.path}</span><span className="sp" />
        {pl.base ? <span className="muted" title="The commit this checkout was on when the task first touched it">against <span className="mono">{pl.base}</span>, where the task started</span> : <span className="muted">Not a git checkout: files as the agent wrote them</span>}
        {pl.kind !== 'outside' ? <button className="btn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'discard' } })}>Discard…</button> : <button className="btn sm" onClick={run(() => toast(`Opened ${pl.path} in the file manager`))}>Open folder</button>}</header>
      {pl.drift && !S.driftDismissed?.[t.id + pl.id] ? <div className="callout warn drift"><Icon n="branch" /><div><b>This worktree is on another branch now.</b> At {pl.drift.at} it moved from <span className="mono">{pl.drift.from}</span> to <span className="mono">{pl.drift.to}</span>{pl.drift.pane ? <>, probably from your terminal "{pl.drift.pane}"</> : null}. The changes below are the task's, compared with where it started.{pl.drift.kept ? ` Its commits are still on ${pl.branch}.` : ''}
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}><button className="btn sm" disabled={pl.drift.dirty} title={pl.drift.dirty ? 'This worktree has uncommitted changes; commit or move them first' : undefined} onClick={run(() => { S.overlay = { type: 'dlg', id: 'driftback', text: pl.branch } })}>Switch back to {pl.branch}</button><button className="btn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'driftfollow', text: pl.drift!.to } })}>Follow the new branch</button>{pl.drift.pane ? <button className="btn sm" onClick={run(() => { S.tab = 'terminal' })}>Open that terminal</button> : null}<button className="btn sm ghost" onClick={run(() => { (S.driftDismissed ||= {})[t.id + pl.id] = true })}>Dismiss</button></div>
        {pl.drift.dirty ? <p style={{ fontSize: 12, marginTop: 6 }}>Switch back is off: this worktree has uncommitted changes; commit or move them first.</p> : null}</div></div> : null}
      {pl.drift && S.driftDismissed?.[t.id + pl.id] ? <><div className="slabel">Changed by the task</div>{pl.files.map(f => <DiffFile key={f.path} f={f} />)}<div className="slabel">Changed by the branch switch <span className="n">{pl.drift.from.split(' @ ')[0]} → {pl.drift.to.split(' @ ')[0]}</span></div>{pl.drift.switchFiles.map(f => <DiffFile key={f.path} f={f} />)}</> : pl.files.map(f => <DiffFile key={f.path} f={f} />)}</section>)}</div></div></div>
}

/** Review by turn (ThreadTurnReview): each turn's files, with undo per turn. */
function TurnReview ({ t }: { t: Task }) {
  const turns = (S.conv[t.id] || []).map((it, i) => ({ it, i })).filter(x => x.it.tools && x.it.tools.some(r => r[1] === 'Edit' || r[1] === 'Create'))
  return <div className="stack" style={{ gap: 10 }}>{turns.map(({ it, i }, n) => { const eds = it.tools!.filter(r => r[1] === 'Edit' || r[1] === 'Create')
    return <div key={i} className="turnc"><div className="row"><b>Turn {n + 1}</b><span className="muted" style={{ fontSize: 12 }}>{plural(eds.length, 'edit')}</span><span className="sp" /><button className="btn sm" onClick={run(() => toast(`Undid turn ${n + 1}'s file changes`, { undo: () => {} }))}>Undo this turn</button></div>
      {eds.map((r, j) => <div key={j} className="row mono" style={{ fontSize: 12 }}><Icon n="pencil" s={12} /><span className="trunc">{r[2]}</span><span className="sp" /><span className="muted">{r[3]}</span></div>)}</div> })}</div>
}
