/* OxeQuery, OxePost and OxePod on their own. Each is a familiar tool first (a database client, an API client,
   a container list). What agents did there is one line at the top that opens the detail. */
import type { ReactNode } from 'react'
import { D } from '../mock/data'
import { S, emit, run, task, plural, toast } from '../state/store'
import { Icon, Av, Kbd, MI, menuBtn, StateBlock } from './ui'
import { MENUS } from './Shell'
import { Highlight, EnvPill, Status, TermView } from './Tools'
import { CodeEditor, CodeBlock, Hl, prettyJson } from './Code'
import { syncScreen } from '../screens/registry'

/** "What agents did here": one line, in the sun color when something waits for you. */
function AgentLine ({ who, text, waiting, open, onOpen }: { who: string[]; text: ReactNode; waiting?: ReactNode; open: boolean; onOpen: () => void }) {
  return <div className={'agent-line' + (waiting ? ' attn' : '')}>{who.map(p => <Av key={p} p={p} size="s16" />)}<span className="what">{text}{waiting ? <b> · {waiting}</b> : null}</span>
    <button className="btn sm ghost" onClick={run(onOpen)}>{open ? 'Back' : 'See what agents did'}<Icon n={open ? 'left' : 'right'} s={12} /></button></div>
}
const ModeTitle = ({ icon, k, title, children }: { icon: string; k: string; title: string; children?: ReactNode }) =>
  <div className="mode-h"><span style={{ color: `var(--${k})` }}><Icon n={icon} s={16} /></span><h2>{title}</h2>{children}</div>
const states = (what: string) => S.view === 'loading' ? <StateBlock kind="loading" /> : S.view === 'error' ? <StateBlock kind="error" title={`Couldn't open ${what}`} text="The local service didn't answer in 5 s. Nothing was lost." /> : null

/* ================================================================ OxeQuery */
export function QueryMode () {
  const st = states('OxeQuery'); if (st) return st
  if (S.view === 'empty') return <div className="mode"><ModeTitle icon="db" k="k-db" title="OxeQuery" /><StateBlock kind="empty" icon="db" title="Connect a database" text="Postgres, MySQL, SQLite, SQL Server and ClickHouse. Agents can use a connection only when you allow it, per connection."><button className="btn pri" onClick={run(() => { S.overlay = { type: 'dlg', id: 'newconn' } })}>New connection</button></StateBlock></div>
  const conn = D.connections.find(c => c.id === S.q.conn)!
  const qs = D.queries.filter(q => q.conn === conn.id)
  const waiting = qs.some(q => q.status === 'pending') && !S.resolved.ap_sql
  const act = S.q.tab === 'activity'
  return <div className="mode-split">
    <aside className="mode-side">
      <button className="conn-pick" onClick={menuBtn('conns')} aria-haspopup="menu"><span className={'sdot ' + (conn.status === 'ok' ? 'on' : 'bad')} /><span className="trunc"><b>{conn.name}</b><small>{conn.engine}</small></span><EnvPill e={conn.env} /><Icon n="down" s={12} /></button>
      <label className="search mside-search"><Icon n="search" s={12} /><input placeholder="Filter tables" aria-label="Filter tables" value={S.tFilter || ''} onChange={e => { S.tFilter = e.target.value; emit() }} /></label>
      <div className="scroll"><div className="lst">{conn.status !== 'ok' ? <div className="callout danger" style={{ margin: 6 }}><Icon n="warn" /><span>Can't reach {conn.host}. The certificate expired on 30/10.</span></div>
        : D.tables.filter(n => !S.tFilter || n.includes(S.tFilter)).map(n => <button key={n} className="tbl-i" onClick={run(() => { S.q.tab = 'editor'; S.q.sql = `SELECT *\n  FROM ${n}\n LIMIT 100;`; toast(`Opened ${n}`) })}><Icon n="grid" s={12} /><span>{n}</span></button>)}</div></div>
      <div className="mside-f"><button className="btn sm ghost" onClick={run(() => { S.overlay = { type: 'dlg', id: 'newconn' } })}><Icon n="plus" s={12} />New connection</button><span className="sp" /><button className="ibtn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'oqsettings' } })} aria-label="OxeQuery settings" title="OxeQuery settings"><Icon n="gear" s={12} /></button></div></aside>
    <section className="mode-main">
      {qs.length ? <AgentLine who={Array.from(new Set(qs.map(q => q.by)))} open={act} onOpen={() => { S.q.tab = act ? 'editor' : 'activity'; syncScreen() }} text={<>Agents ran {plural(qs.length, 'statement')} on {conn.name} today</>} waiting={waiting ? '1 write is waiting for you' : undefined} /> : <div className="agent-line"><Icon n="shield" s={12} /><span className="what">Agents: {({ off: 'not allowed on this connection', read: 'can read', confirm: 'can read; they ask before writing', write: 'can read and write' } as Record<string, string>)[conn.agent]}</span></div>}
      {act ? <QueryActivity conn={conn.id} /> : <QueryEditor />}</section></div>
}
MENUS.conns = () => <><div className="mg">Connections</div>{D.connections.map(c => <MI key={c.id} check={S.q.conn === c.id} label={c.name} hint={`${c.engine} · ${c.env}`} onClick={() => { S.q.conn = c.id }} />)}<hr /><MI icon="plus" label="New connection…" onClick={() => { S.overlay = { type: 'dlg', id: 'newconn' } }} /></>
function QueryEditor () {
  const q = D.queries.find(x => x.id === 'q4')!
  const tab = S.q.qtab ?? 0
  const sql = tab === 1 ? (S.q.untitled ?? '') : (S.q.sql ?? q.sql)
  const runQ = () => { S.qRunning = true; emit(); setTimeout(() => { S.qRunning = false; S.qRan = true; emit() }, 700) }
  const cell = (c: string, v: string) => c === 'amount' ? <td key={c} className="r num">{Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td> : c === 'status' ? <td key={c}><span className={'cell-st ' + v}>{v}</span></td> : v === '' || v == null ? <td key={c} className="null">NULL</td> : c.endsWith('_at') ? <td key={c} className="num muted2">{v}</td> : <td key={c}>{v}</td>
  return <div className="qed">
    <div className="qtabs" role="tablist">{['open-invoices.sql', 'Untitled'].map((n, i) => <button key={n} role="tab" aria-selected={tab === i} onClick={run(() => { S.q.qtab = i })}><Icon n="db" s={12} />{n}{i === 0 && S.q.sql !== undefined ? <span className="dirty" title="Unsaved changes" /> : null}</button>)}<button className="ibtn sm" aria-label="New query tab" title="New query tab" onClick={run(() => toast('Opened a new query tab'))}><Icon n="plus" s={12} /></button></div>
    <div className="qbar"><button className="btn sm pri" onClick={run(runQ)}><Icon n="play" s={12} />Run<kbd className="k">Ctrl ↵</kbd></button><button className="btn sm" onClick={run(() => toast('EXPLAIN: Index Scan using invoice_items_invoice_id_idx (cost 0.43..8.45)'))}>Explain</button><button className="btn sm ghost" onClick={run(() => toast('Formatted'))}>Format</button>
      <span className="vsep" /><label className="qlim">Limit<select className="sel" aria-label="Row limit" defaultValue="500"><option>100</option><option>500</option><option>5,000</option></select></label><span className="sp" /><span className="muted" style={{ fontSize: 12 }}>Read-only session · staging</span></div>
    <CodeEditor lang="sql" label="SQL" value={sql} placeholder="Write a query. Ctrl Enter runs it." onRun={runQ} onChange={v => { if (tab === 1) S.q.untitled = v; else S.q.sql = v }} />
    <div className="qres-h"><b>Results</b>{S.qRunning ? <span className="muted"><span className="spin" style={{ display: 'inline-block', verticalAlign: -2, marginRight: 6 }} />Running…</span> : <><span className="res ok">5 rows</span><span className="muted num">96 ms</span><span className="muted">billing-staging</span></>}<span className="sp" /><button className="btn sm ghost" onClick={run(() => toast('Copied 5 rows as CSV'))}><Icon n="copy" s={12} />Copy</button><button className="btn sm ghost" onClick={run(() => toast('Exported results.csv'))}><Icon n="download" s={12} />Export</button></div>
    <div className="scroll">{S.qRunning ? <StateBlock kind="loading" /> : <table className="grid-t rgrid"><thead><tr><th className="rn">#</th>{q.cols.map(c => <th key={c} className={c === 'amount' ? 'r' : ''}>{c}<small>{c === 'amount' ? 'numeric' : c.endsWith('_at') ? 'timestamptz' : 'text'}</small></th>)}</tr></thead>
      <tbody>{q.data.map((r, i) => <tr key={i}><td className="rn">{i + 1}</td>{r.map((v, j) => cell(q.cols[j], v))}</tr>)}</tbody></table>}</div></div>
}
function QueryActivity ({ conn }: { conn: string }) {
  const qs = D.queries.filter(q => q.conn === conn)
  return <div className="scroll"><table className="ctable act-t"><thead><tr><th>When</th><th>Agent</th><th>Task</th><th>Statement</th><th className="r">Rows</th><th>Result</th></tr></thead>
    <tbody>{qs.map(q => { const pend = q.status === 'pending' && !S.resolved.ap_sql
      return <tr key={q.id} className="click" tabIndex={0} onClick={run(() => { S.overlay = { type: 'dlg', id: 'qrow', q: q.id } })} onKeyDown={e => { if (e.key === 'Enter') { S.overlay = { type: 'dlg', id: 'qrow', q: q.id }; emit() } }}>
        <td className="mono">{q.at.slice(-8, -3) || q.at}</td><td><Av p={q.by} size="s16" /></td><td className="ttl">{task(q.task)?.title || 'Explain the settlement batch job'}</td><td className="mono stmt">{q.sql.split('\n')[0]}</td><td className="mono r">{q.rows.toLocaleString('en')}</td>
        <td>{q.status === 'ok' ? <span className="res ok">Ran</span> : pend ? <span className="res attn">Waiting for you</span> : q.status === 'pending' ? <span className="res ok">{S.resolved.ap_sql === 'deny' ? 'Denied by you' : 'Ran after approval'}</span> : <span className="res dz">Not allowed</span>}</td></tr> })}</tbody></table></div>
}

/* ================================================================ OxePost */
export function PostMode () {
  const st = states('OxePost'); if (st) return st
  if (S.view === 'empty') return <div className="mode"><ModeTitle icon="net" k="k-net" title="OxePost" /><StateBlock kind="empty" icon="net" title="Send your first request" text="Group requests in collections and switch environments without editing URLs."><button className="btn pri" onClick={run(newRequest)}>New request</button><button className="btn" onClick={run(() => { S.overlay = { type: 'dlg', id: 'import' } })}>Import</button></StateBlock></div>
  const saved = S.post.newReq ? null : D.requests[S.post.req]
  const r = S.post.newReq || D.requests[S.post.req]
  const agentReqs = Object.values(D.requests).filter(x => x.task)
  const act = S.post.activity
  return <div className="mode-split">
    <aside className="mode-side"><div className="mside-h"><b>Collections</b><span className="sp" /><button className="ibtn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'import' } })} title="Import" aria-label="Import"><Icon n="upload" s={12} /></button><button className="ibtn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'envs' } })} title="Environments" aria-label="Environments"><Icon n="layers" s={12} /></button><button className="ibtn sm" onClick={run(newRequest)} title="New request" aria-label="New request"><Icon n="plus" s={12} /></button></div>
      <div className="scroll"><div className="lst">{D.collections.map(c => <div key={c.id}><div className="tg">{c.name}</div>
        {(c.id === S.post.col && S.post.newReq ? ['new'] : []).concat(c.reqs).map(id => { const q = id === 'new' ? S.post.newReq! : D.requests[id]; const on = id === 'new' ? true : !S.post.newReq && S.post.req === id
          return <button key={id} className="req-i" aria-current={on} onClick={run(() => { if (id !== 'new') { S.post.newReq = null; S.post.req = id; S.post.sentNew = false; S.post.activity = false } })}><span className={'meth ' + q.method}>{q.method}</span><span className="trunc">{q.name}</span></button> })}</div>)}</div></div></aside>
    <section className="mode-main">
      <AgentLine who={['claude']} open={act} onOpen={() => { S.post.activity = !act; syncScreen() }} text={<>Agents sent {plural(agentReqs.length, 'request')} today</>} waiting={agentReqs.some(x => x.blocked) ? '1 blocked by policy' : undefined} />
      {act ? <PostActivity /> : <div className="req">
        <div className="req-top"><input className="req-name" id="req-name" value={r.name} aria-label="Request name" onChange={e => { if (S.post.newReq) S.post.newReq.name = e.target.value; else D.requests[S.post.req].name = e.target.value; emit() }} />
          <select className="sel" aria-label="Environment" style={{ height: 28 }} value={S.post.env || 'sandbox'} onChange={e => { S.post.env = e.target.value; emit() }}>{D.envs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
        <div className="reqbar"><select className={'mth ' + r.method} aria-label="Method" value={r.method} onChange={e => { if (S.post.newReq) { S.post.newReq.method = e.target.value; emit() } }}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(x => <option key={x}>{x}</option>)}</select>
          <div className="urlf"><pre aria-hidden="true"><Hl s={r.url} lang="url" /></pre><input id="req-url" value={r.url} aria-label="URL" spellCheck={false} onChange={e => { if (S.post.newReq) S.post.newReq.url = e.target.value; else D.requests[S.post.req].url = e.target.value; emit() }} /></div>
          <button className="btn pri sendb" onClick={run(send)}><Icon n="send" s={12} />Send</button></div>
        <div className="req-split"><div className="req-in"><div className="subtabs">{['Body', 'Headers', 'Auth'].map(x => <button key={x} aria-selected={S.post.tab === x.toLowerCase()} onClick={run(() => { S.post.tab = x.toLowerCase() })}>{x}{x === 'Headers' && saved ? <span className="cnt">{saved.headers.length || 1}</span> : null}</button>)}<span className="sp" />{S.post.tab === 'body' ? <span className="ctype">JSON</span> : null}</div>
          {S.post.tab === 'headers' ? <div className="hdrs">{(saved && saved.headers.length ? saved.headers : [['Content-Type', 'application/json']]).map(([k, v]) => <div key={k} className="hdr"><span className="mono k">{k}</span><span className="mono v">{v.includes('••••') ? <span className="secret"><Icon n="lock" s={12} />{v}</span> : v}</span></div>)}</div>
            : S.post.tab === 'auth' ? <div style={{ padding: 12, display: 'grid', gap: 6 }}><div className="field"><label>Type</label><select className="sel"><option>Bearer token from the environment</option></select></div><p className="muted" style={{ fontSize: 12 }}>Secrets come from your keychain and show as •••• (NAME). Agents never see them.</p></div>
              : <CodeEditor lang="json" label="Body" value={S.post.body?.[S.post.newReq ? 'new' : S.post.req] ?? (saved ? saved.reqBody : '')} placeholder="No body" onChange={v => { (S.post.body ||= {})[S.post.newReq ? 'new' : S.post.req] = v }} />}</div>
          <div className="req-out">{S.post.sending ? <StateBlock kind="loading" /> : (!S.post.newReq && 'status' in r && (r.status || ('blocked' in r && r.blocked))) || S.post.sentNew ? <>
            <div className="resp-h">{'blocked' in r && r.blocked ? <span className="stchip dz">Blocked by policy</span> : <span className={'stchip s' + String(r.status || 200)[0]}>{r.status || 200} {({ 200: 'OK', 201: 'Created', 401: 'Unauthorized', 404: 'Not found', 500: 'Server error' } as Record<number, string>)[r.status || 200] || ''}</span>}<span className="num muted">{r.ms || 54} ms</span><span className="muted">{r.size || '7.8 kB'}</span><span className="sp" /><div className="segc"><button aria-pressed={!S.post.raw} onClick={run(() => { S.post.raw = false })}>Pretty</button><button aria-pressed={!!S.post.raw} onClick={run(() => { S.post.raw = true })}>Raw</button></div></div>
            {'blocked' in r && r.blocked ? <div className="callout danger" style={{ margin: 12 }}><Icon n="shield" /><span>api.cajui.com.br is a production host. Agents may call the sandbox and localhost only.</span></div> : <div className="resp-b">{S.post.raw ? <pre className="cblk-b">{(r.resBody || '{ "ok": true }').replace(/\s+/g, ' ')}</pre> : <CodeBlock lang="json" code={prettyJson(r.resBody || '{ "ok": true }')} title="application/json" numbers />}</div>}</>
            : <div className="state"><p style={{ fontSize: 12 }}>Send the request to see the response here.</p></div>}</div></div></div>}</section></div>
}
function newRequest () { S.area = 'mode'; S.mode2 = 'post'; S.view = S.view === 'empty' ? 'live' : S.view; S.post.activity = false; S.post.newReq = { name: 'Untitled request', method: 'GET', url: '{{base_url}}/v2/merchants', resBody: '' }; S.post.sentNew = false; S.post.tab = 'body'; syncScreen(); setTimeout(() => { const el = document.getElementById('req-name') as HTMLInputElement | null; el?.focus(); el?.select() }, 30) }
function send () { S.post.sending = true; setTimeout(() => { S.post.sending = false; if (S.post.newReq) { S.post.sentNew = true; Object.assign(S.post.newReq, { status: 200, ms: 54, size: '7.8 kB', resBody: '{\n  "data": [ { "id": "m_1Qa", "name": "Padaria Boa Vista" }, … 19 more ],\n  "next": "m_2Xk"\n}' }) } emit() }, 600) }
function PostActivity () {
  const rs = Object.values(D.requests).filter(x => x.task)
  return <div className="scroll"><table className="ctable act-t"><thead><tr><th>When</th><th>Agent</th><th>Task</th><th>Request</th><th>Result</th><th className="r">Time</th></tr></thead>
    <tbody>{rs.map(x => <tr key={x.id} className="click" tabIndex={0} onClick={run(() => { S.overlay = { type: 'dlg', id: 'prow', r: x.id } })}><td className="mono">{x.at?.slice(0, 5)}</td><td><Av p={x.by!} size="s16" /></td><td className="ttl">{task(x.task!)?.title}</td><td><span className={'meth ' + x.method}>{x.method}</span> {x.name}</td>
      <td>{x.blocked ? <span className="res dz">Blocked</span> : <Status s={x.status} />}</td><td className="mono r">{x.ms ? x.ms + ' ms' : '—'}</td></tr>)}</tbody></table></div>
}

/* ================================================================ OxePod */
export function PodMode () {
  const st = states('Docker'); if (st) return st
  if (S.view === 'empty') return <div className="mode"><ModeTitle icon="box" k="k-box" title="OxePod" /><StateBlock kind="empty" icon="box" title="No containers running" text="Start a compose stack from a project, or run an image."><button className="btn pri" onClick={run(() => { S.view = 'live'; toast('Started the cajui-api stack') })}>Start the cajui-api stack</button></StateBlock></div>
  const c = D.containers.find(x => x.id === S.pod.sel) || D.containers[0]
  const stacks = Array.from(new Set(D.containers.map(x => x.stack)))
  const byAgent = D.containers.filter(x => x.task)
  return <div className="mode pod">
    <ModeTitle icon="box" k="k-box" title="OxePod"><span className="muted" style={{ fontSize: 12 }}>{D.containers.filter(x => x.status === 'running').length} running · {D.containers.filter(x => x.status !== 'running').length} stopped</span><span className="sp" /><button className="btn sm" onClick={run(() => toast('Opens docker-compose.yml from a project'))}><Icon n="plus" s={12} />Start a stack</button></ModeTitle>
    <AgentLine who={['claude', 'codex']} open={!!S.podAgent} onOpen={() => { S.podAgent = !S.podAgent }} text={<>{plural(byAgent.length, 'container')} run in the folders of 3 conversations</>} waiting={S.resolved.ap_down ? undefined : 'T-144 wants to remove a volume'} />
    <div className="scroll pod-list"><table className="ctable"><thead><tr><th style={{ width: 20 }} /><th>Name</th><th>Image</th><th>Status</th><th>Ports</th><th className="r">CPU</th><th className="r">Memory</th><th>Folder</th></tr></thead>
      {stacks.map(s => <tbody key={s}><tr className="grp"><td colSpan={8}>{s}</td></tr>{D.containers.filter(x => x.stack === s && (!S.podAgent || x.task)).map(x => <tr key={x.id} className="click" aria-selected={x.id === c.id} tabIndex={0} onClick={run(() => { S.pod.sel = x.id })}>
        <td><span className={'sdot ' + (x.status === 'running' ? 'on' : 'bad')} /></td><td><b>{x.name}</b></td><td className="mono">{x.image}</td><td>{x.status === 'running' ? 'Up ' + x.up : <span className="dz-t">{x.up}</span>}</td><td className="mono">{x.ports}</td><td className="mono r">{x.cpu}</td><td className="mono r">{x.mem}</td><td className="ttl">{x.task ? <span title={`Compose working_dir is a place of "${task(x.task)?.title}"`}>This conversation's folder · {task(x.task)?.title}</span> : <span className="muted">Started outside OXESpace</span>}</td></tr>)}</tbody>)}</table></div>
    <div className="pod-detail"><div className="pane-h"><span className={'sdot ' + (c.status === 'running' ? 'on' : 'bad')} /><h3>{c.name}</h3><span className="muted mono" style={{ fontSize: 11 }}>{c.image}</span><span className="sp" />
      {c.status === 'running' ? <button className="btn sm" onClick={run(() => { c.status = 'exited'; c.up = 'Exited (0) just now'; toast(`Stopped ${c.name}`, { undo: () => { c.status = 'running'; c.up = 'just now'; emit() } }) })}><Icon n="stop" s={12} />Stop</button>
        : <button className="btn sm" onClick={run(() => { c.status = 'running'; c.up = 'just now'; toast(`Started ${c.name}`) })}><Icon n="play" s={12} />Start</button>}
      <button className="btn sm" onClick={run(() => toast(`Restarted ${c.name}`))}><Icon n="restart" s={12} />Restart</button><button className="btn sm" disabled={c.status !== 'running'} title={c.status !== 'running' ? 'Start the container first' : undefined} onClick={run(() => toast(`A shell in ${c.name} opens in OxeCode`))}><Icon n="term" s={12} />Terminal</button>
      <button className="ibtn" onClick={menuBtn('podmore')} aria-label="More container actions"><Icon n="more" /></button></div>
      <TermView k={{ id: 'pl', name: '', shell: '', cwd: '', by: '', lines: (D.logs[c.id] || [c.status === 'running' ? '14:11:02  info  ready' : 'No logs.']).map(l => [/error|FATAL/.test(l) ? 'err' : /warn|DETAIL/.test(l) ? 'dim' : '', l]) }} live={c.status === 'running'} /></div></div>
}
MENUS.podmore = () => { const c = D.containers.find(x => x.id === S.pod.sel) || D.containers[0]; return <><MI icon="copy" label="Copy container ID" onClick={() => toast('Copied the container ID')} /><MI icon="info" label="Environment and ports" hint={`${c.ports}${c.vol ? ' · volume ' + c.vol : ''}`} /><hr /><MI icon="box" dz label="Stop the whole stack…" hint={`docker compose down in ${c.stack}`} onClick={() => { S.overlay = { type: 'dlg', id: 'poddown' } }} /><MI icon="trash" dz label="Remove container…" onClick={() => { S.overlay = { type: 'dlg', id: 'podremove', c: c.id } }} /></> }
export { Highlight }
