/* OxeQuery on its own: a database client first. What agents did here is a badge that opens Agent activity,
   filtered to databases. (1.5.0: OxePost and OxePod left the mode switcher; they are panels now, in Cockpit.tsx.) */
import type { ReactNode } from 'react'
import { ActivityBadge } from './Cockpit'
import { D } from '../mock/data'
import { S, emit, run, task, plural, toast } from '../state/store'
import { Icon, Av, Kbd, MI, menuBtn, StateBlock } from './ui'
import { MENUS } from './Shell'
import { Highlight, EnvPill, Status, TermView } from './Tools'
import { CodeEditor, CodeBlock, Hl, prettyJson } from './Code'
import { syncScreen } from '../screens/registry'

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
  return <div className="mode-split">
    <aside className="mode-side">
      <button className="conn-pick" onClick={menuBtn('conns')} aria-haspopup="menu"><span className={'sdot ' + (conn.status === 'ok' ? 'on' : 'bad')} /><span className="trunc"><b>{conn.name}</b><small>{conn.engine}</small></span><EnvPill e={conn.env} /><Icon n="down" s={12} /></button>
      <label className="search mside-search"><Icon n="search" s={12} /><input placeholder="Filter tables" aria-label="Filter tables" value={S.tFilter || ''} onChange={e => { S.tFilter = e.target.value; emit() }} /></label>
      <div className="scroll"><div className="lst">{conn.status !== 'ok' ? <div className="callout danger" style={{ margin: 6 }}><Icon n="warn" /><span>Can't reach {conn.host}. The certificate expired on 30/10.</span></div>
        : D.tables.filter(n => !S.tFilter || n.includes(S.tFilter)).map(n => <button key={n} className="tbl-i" onClick={run(() => { S.q.tab = 'editor'; S.q.sql = `SELECT *\n  FROM ${n}\n LIMIT 100;`; toast(`Opened ${n}`) })}><Icon n="grid" s={12} /><span>{n}</span></button>)}</div></div>
      <div className="mside-f"><button className="btn sm ghost" onClick={run(() => { S.overlay = { type: 'dlg', id: 'newconn' } })}><Icon n="plus" s={12} />New connection</button><span className="sp" /><button className="ibtn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'oqsettings' } })} aria-label="OxeQuery settings" title="OxeQuery settings"><Icon n="gear" s={12} /></button></div></aside>
    <section className="mode-main">
      <div className="mode-top"><span className="muted" style={{ fontSize: 12 }}>Agents: {({ off: 'not allowed', read: 'can read', confirm: 'read; ask before writing', write: 'read and write' } as Record<string, string>)[conn.agent]}</span><span className="sp" /><ActivityBadge src="db" n={qs.length} waiting={waiting} /></div>
      <QueryEditor /></section></div>
}
MENUS.conns = () => <><div className="mg">Connections</div>{D.connections.map(c => <MI key={c.id} check={S.q.conn === c.id} label={c.name} hint={`${c.engine} · ${c.env}`} onClick={() => { S.q.conn = c.id }} />)}<hr /><MI icon="plus" label="New connection…" onClick={() => { S.overlay = { type: 'dlg', id: 'newconn' } }} /></>
function QueryEditor () {
  const q = D.queries.find(x => x.id === 'q4')!
  const tab = S.q.qtab ?? 0
  const sql = tab === 1 ? (S.q.untitled ?? '') : (S.q.sql ?? q.sql)
  const runQ = () => { S.qRunning = true; emit(); setTimeout(() => { S.qRunning = false; S.qRan = true; emit() }, 700) }
  const cell = (c: string, v: string) => c === 'amount' ? <td key={c} className="r num">{Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td> : c === 'status' ? <td key={c}><span className={'cell-st ' + v}>{v}</span></td> : v === '' || v == null ? <td key={c} className="null">NULL</td> : c.endsWith('_at') ? <td key={c} className="num muted2">{v}</td> : <td key={c}>{v}</td>
  return <div className="qed">
    <div className="qtabs-row"><div className="qtabs" role="tablist" aria-label="Query tabs">{['open-invoices.sql', 'Untitled'].map((n, i) => <button key={n} role="tab" aria-selected={tab === i} onClick={run(() => { S.q.qtab = i })}><Icon n="db" s={12} />{n}{i === 0 && S.q.sql !== undefined ? <span className="dirty" title="Unsaved changes" /> : null}</button>)}</div><button className="ibtn sm" aria-label="New query tab" title="New query tab" onClick={run(() => toast('Opened a new query tab'))}><Icon n="plus" s={12} /></button></div>
    <div className="qbar"><button className="btn sm pri" onClick={run(runQ)}><Icon n="play" s={12} />Run<kbd className="k">Ctrl ↵</kbd></button><button className="btn sm" onClick={run(() => toast('EXPLAIN: Index Scan using invoice_items_invoice_id_idx (cost 0.43..8.45)'))}>Explain</button><button className="btn sm ghost" onClick={run(() => toast('Formatted'))}>Format</button>
      <span className="vsep" /><label className="qlim">Limit<select className="sel" aria-label="Row limit" defaultValue="500"><option>100</option><option>500</option><option>5,000</option></select></label><span className="sp" /><span className="muted" style={{ fontSize: 12 }}>Read-only session · staging</span></div>
    <CodeEditor lang="sql" label="SQL" value={sql} placeholder="Write a query. Ctrl Enter runs it." onRun={runQ} onChange={v => { if (tab === 1) S.q.untitled = v; else S.q.sql = v }} />
    <div className="qres-h"><b>Results</b>{S.qRunning ? <span className="muted"><span className="spin" style={{ display: 'inline-block', verticalAlign: -2, marginRight: 6 }} />Running…</span> : <><span className="res ok">5 rows</span><span className="muted num">96 ms</span><span className="muted">billing-staging</span></>}<span className="sp" /><button className="btn sm ghost" onClick={run(() => toast('Copied 5 rows as CSV'))}><Icon n="copy" s={12} />Copy</button><button className="btn sm ghost" onClick={run(() => toast('Exported results.csv'))}><Icon n="download" s={12} />Export</button></div>
    <div className="scroll">{S.qRunning ? <StateBlock kind="loading" /> : <table className="grid-t rgrid"><thead><tr><th className="rn">#</th>{q.cols.map(c => <th key={c} className={c === 'amount' ? 'r' : ''}>{c}<small>{c === 'amount' ? 'numeric' : c.endsWith('_at') ? 'timestamptz' : 'text'}</small></th>)}</tr></thead>
      <tbody>{q.data.map((r, i) => <tr key={i}><td className="rn">{i + 1}</td>{r.map((v, j) => cell(q.cols[j], v))}</tr>)}</tbody></table>}</div></div>
}
