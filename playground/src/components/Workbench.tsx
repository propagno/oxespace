/* Workbench panels that exist in 1.4 (Workbench/panelCatalog.ts) and stay in 1.5.0: Files (FileBrowser + EditorPane),
   Browser (WebPreviewPanel), Git (GitControlPanel, GitHubPanel, LinearPanel), Scripts, Search, Worktrees,
   Background. OxeChat opens them as tabs from "+ Tool"; OxeCode docks them on the right. */
import { D } from '../mock/data'
import { S, emit, run, toast, plural, task, prov, type AppState } from '../state/store'
import { Icon, Av, Kbd, MI, StateBlock } from './ui'
import { CodeEditor, type Lang } from './Code'
import { TermView } from './Tools'
import { PLACES } from '../mock/locations'

export const TOOLS: [string, string, string, string][] = [
  ['files', 'file', 'Files', 'Ctrl E'], ['browser', 'globe', 'Browser', 'Ctrl Shift B'], ['git', 'branch', 'Git and pull request', ''], ['scripts', 'play', 'Scripts', ''],
  ['search', 'search', 'Search', 'Ctrl Shift F'], ['worktrees', 'layers', 'Worktrees', ''], ['background', 'activity', 'Background', '']
]
const TREE: [number, string, boolean?][] = [[0, 'migrations', true], [1, '0042_idempotency_keys.sql'], [1, '0043_invoice_items_invoice_id_idx.sql'], [0, 'src', true], [1, 'charges', true], [2, 'create.ts'], [2, 'idempotency.ts'], [2, 'routes.ts'], [1, 'reports', true], [2, 'invoice-report.ts'], [1, 'webhooks', true], [2, 'pix.ts'], [2, 'signature.ts'], [1, 'server.ts'], [0, 'test', true], [0, 'docker-compose.yml'], [0, 'package.json'], [0, 'README.md']]
const FILES: Record<string, [Lang, string]> = {
  'idempotency.ts': ['ts', 'import { SQL, type Tx } from \'../db\'\n\n// Locks the key row so two parallel retries can\'t both create a charge.\nexport async function lock(tx: Tx, key: string, requestHash: string) {\n  const row = await tx.one(SQL`SELECT * FROM idempotency_keys WHERE key = ${key} FOR UPDATE`)\n  if (!row) { await tx.insertKey(key, requestHash); return null }\n  if (row.request_hash !== requestHash) return { conflict: true }\n  return { response: row.response }\n}\n\nexport async function save(tx: Tx, key: string, response: unknown) {\n  await tx.query(SQL`UPDATE idempotency_keys SET response = ${response} WHERE key = ${key}`)\n}\n'],
  'invoice-report.ts': ['ts', 'export async function invoiceReport(month: string) {\n  const invoices = await db.query(\'SELECT * FROM invoices WHERE month = $1\', [month])\n  const items = await db.query(\'SELECT * FROM invoice_items WHERE invoice_id = ANY($1)\', [invoices.map(i => i.id)])\n  const byInvoice = groupBy(items, \'invoice_id\')\n  for (const inv of invoices) inv.items = byInvoice[inv.id] ?? []\n  return toCsv(invoices)\n}\n'],
  'package.json': ['json', '{\n  "name": "cajui-api",\n  "version": "2026.11.2",\n  "scripts": {\n    "dev": "tsx watch src/server.ts",\n    "test": "vitest run",\n    "lint": "eslint src",\n    "db:migrate": "node scripts/migrate.mjs",\n    "report:invoice": "tsx scripts/invoice-report.ts"\n  }\n}\n'],
  '0043_invoice_items_invoice_id_idx.sql': ['sql', '-- Speeds up the monthly invoice report\nCREATE INDEX CONCURRENTLY invoice_items_invoice_id_idx\n  ON invoice_items (invoice_id);\n']
}

export function ToolPanel ({ id, t }: { id: string; t?: { id: string; branch: string; project: string } }) {
  if (S.view === 'loading') return <StateBlock kind="loading" />
  if (id === 'files') return <FilesPanel t={t} />
  if (id === 'browser') return <BrowserPanel />
  if (id === 'git') return <GitPanel t={t} />
  if (id === 'scripts') return <ScriptsPanel />
  if (id === 'search') return <SearchPanel />
  if (id === 'worktrees') return <WorktreesPanel />
  return <BackgroundPanel />
}

function FilesPanel ({ t }: { t?: { branch: string } }) {
  const open = S.wbFile || 'idempotency.ts'; const outside = S.wbRO && S.wbRO.endsWith(open) ? S.wbRO : null
  const fromPlace = outside ? (PLACES.t147.find(p => p.kind === 'outside')?.files.find(f => f.path === open)?.hunks.map(h => h[1]).join('\n') || '') : null
  const [lang, code] = fromPlace != null ? [open.endsWith('.js') ? 'ts' as Lang : 'text' as Lang, fromPlace] : FILES[open] || ['text', '// Preview of ' + open]
  const tabs = S.wbTabs || ['idempotency.ts', 'package.json']
  return <div className={'files-p' + (S.wbTree === false ? ' notree' : '')}><div className="ftree"><div className="mside-h"><b>cajui-api</b><span className="sp" /><span className="mono muted" style={{ fontSize: 11 }}>{t?.branch || 'main'}</span></div>
    <div className="scroll">{TREE.map(([d, n, dir], i) => <button key={i} className={'fnode' + (dir ? ' dir' : '') + (n === open ? ' on' : '')} style={{ paddingLeft: 10 + d * 14 }} onClick={run(() => { if (dir) return; S.wbFile = n; if (!tabs.includes(n)) S.wbTabs = tabs.concat(n) })}><Icon n={dir ? 'folder' : 'file'} s={12} /><span className="trunc">{n}</span>{['create.ts', 'idempotency.ts', 'routes.ts', '0043_invoice_items_invoice_id_idx.sql', 'invoice-report.ts'].includes(n) ? <span className="fm">M</span> : null}</button>)}</div></div>
    <div className="feditor"><div className="ftabs"><button className="ibtn sm" aria-label={S.wbTree === false ? 'Show the file tree' : 'Hide the file tree'} aria-pressed={S.wbTree !== false} title="File tree" onClick={run(() => { S.wbTree = S.wbTree === false })}><Icon n="sidebar" s={12} /></button><div className="qtabs" role="tablist" aria-label="Open files">{tabs.map(n => <button key={n} role="tab" aria-selected={n === open} onClick={run(() => { S.wbFile = n })}><Icon n="file" s={12} />{n}</button>)}</div>{tabs.filter(n => n === open).map(n => <button key={'x' + n} className="ibtn sm" aria-label={`Close ${n}`} title={`Close ${n}`} onClick={run(() => { S.wbTabs = tabs.filter(x => x !== n); if (open === n) S.wbFile = S.wbTabs[0] })}><Icon n="x" s={12} /></button>)}<span className="sp" />{outside ? <button className="btn sm" onClick={run(() => toast(`Copied ${outside}`))}><Icon n="copy" s={12} />Copy path</button> : <button className="btn sm" onClick={run(() => toast(`Opened ${open} in VS Code`))}><Icon n="ext" s={12} />Open in editor</button>}</div>
      {outside ? <div className="ro-band"><Icon n="lock" s={12} />Read only · outside the repository · {outside}</div> : null}<CodeEditor lang={lang} label={open} readOnly={!!outside} value={outside ? code : S.wbEdits?.[open] ?? code} onChange={v => { (S.wbEdits ||= {})[open] = v }} /></div></div>
}
function BrowserPanel () {
  const url = S.wbUrl ?? 'http://localhost:3002/statements'
  return <div className="browser"><div className="bbar"><button className="ibtn sm" aria-label="Back"><Icon n="left" s={12} /></button><button className="ibtn sm" aria-label="Reload" onClick={run(() => toast('Reloaded'))}><Icon n="refresh" s={12} /></button>
    <input className="input mono" value={url} aria-label="Address" onChange={e => { S.wbUrl = e.target.value; emit() }} /><button className="btn sm" onClick={run(() => toast('Pick an element to send it to the agent'))}><Icon n="sparkle" s={12} />Grab for the agent</button><button className="btn sm" onClick={run(() => toast('Opened in your browser'))}><Icon n="ext" s={12} /></button></div>
    <div className="bview"><div className="site"><div className="site-h"><b>Cajuí</b><span>Statements</span><span>Charges</span><span>Refunds</span><span className="sp" /><span className="av-s">MS</span></div>
      <div className="site-b"><div className="row"><h3>Statements · March 2026</h3><span className="sp" /><span className="site-btn">Download CSV</span></div>
        <table><thead><tr><th>Date</th><th>Description</th><th className="r">Amount</th></tr></thead><tbody>{[['03/04', 'Pix · Padaria Boa Vista', '1.240,00'], ['03/04', 'Pix · Ótica Central', '389,90'], ['03/05', 'Refund · Studio Pilates Lis', '-210,00'], ['03/05', 'Pix · Mercadinho São José', '76,40']].map(r => <tr key={r[1]}><td>{r[0]}</td><td>{r[1]}</td><td className="r">R$ {r[2]}</td></tr>)}</tbody></table></div></div></div></div>
}
function GitPanel ({ t }: { t?: { id: string; branch: string } }) {
  const tk = t ? task(t.id) : undefined
  return <div className="scroll"><div className="detail" style={{ maxWidth: 760 }}>
    <section className="ssec"><div className="ssec-h"><h2>Branch</h2><span className="mono" style={{ fontSize: 12 }}>{t?.branch || 'main'}</span><span className="muted" style={{ fontSize: 12 }}>· 3 commits ahead of main</span></div>
      {[['M', 'src/charges/create.ts'], ['A', 'src/charges/idempotency.ts'], ['A', 'migrations/0042_idempotency_keys.sql']].map(([s, f]) => <div key={f} className="srow" style={{ padding: '6px 16px' }}><span className="mono" style={{ fontSize: 12 }}><span className={'gst ' + s}>{s}</span> {f}</span><label className="row" style={{ fontSize: 12 }}><input type="checkbox" defaultChecked /> Stage</label></div>)}
      <div className="srow wide"><textarea className="input" rows={2} defaultValue="Make charge creation idempotent" aria-label="Commit message" /><div className="row"><span className="sp" /><button className="btn sm" onClick={run(() => toast('Pulled: already up to date'))}>Pull</button><button className="btn sm pri" onClick={run(() => toast('Committed 3 files'))}>Commit</button></div></div></section>
    <section className="ssec"><div className="ssec-h"><h2>GitHub</h2><span className="res ok">cajui/cajui-api</span></div>{(tk?.pr ? [D.prs[tk.pr]] : [D.prs[318], D.prs[315]]).map(pr => <div key={pr.n} className="srow" style={{ padding: '8px 16px' }}><div className="l"><b><Icon n="pr" s={12} />#{pr.n} {pr.title}</b><p>{pr.state === 'merged' ? 'Merged' : 'Open'} · {pr.checks.filter(c => c[1] === 'pass').length}/{pr.checks.length} checks · {pr.reviewers[0][0]}</p></div><button className="btn sm" onClick={run(() => toast(`Opened #${pr.n} on GitHub`))}><Icon n="ext" s={12} /></button></div>)}</section>
    <section className="ssec"><div className="ssec-h"><h2>Linear</h2><span className="res ok">Cajuí · Payments</span></div>{[['CAJ-412', 'Pix refunds for merchants', 'In progress'], ['CAJ-398', 'Idempotent charge creation', 'In review']].map(([k, ti, st]) => <div key={k} className="srow" style={{ padding: '8px 16px' }}><div className="l"><b><span className="mono">{k}</span> {ti}</b><p>{st} · Marina Sá</p></div><button className="btn sm" onClick={run(() => toast(`Linked ${k} to this task`))}>Link</button></div>)}</section></div></div>
}
function ScriptsPanel () {
  return <div className="scroll"><div className="lst">{[['dev', 'tsx watch src/server.ts', 'running'], ['test', 'vitest run', ''], ['lint', 'eslint src', ''], ['db:migrate', 'node scripts/migrate.mjs', ''], ['report:invoice', 'tsx scripts/invoice-report.ts', '']].map(([n, c, st]) => <div key={n} className="script-r"><Icon n="play" s={12} /><div><b className="mono">{n}</b><small className="mono">{c}</small></div><span className="sp" />{st ? <span className="res ok">Running</span> : null}<button className="btn sm" onClick={run(() => toast(`npm run ${n} started in a new terminal`))}>{st ? 'Restart' : 'Run'}</button></div>)}</div></div>
}
function SearchPanel () {
  const q = S.wbSearch ?? 'idempotency'
  const hits: [string, number, string][] = [['src/charges/create.ts', 4, 'import * as idempotency from \'./idempotency\''], ['src/charges/create.ts', 21, 'const prior = await idempotency.lock(tx, key, hash(req))'], ['src/charges/idempotency.ts', 3, '// Locks the key row so two parallel retries…'], ['migrations/0042_idempotency_keys.sql', 1, 'CREATE TABLE idempotency_keys (']]
  return <div className="scroll"><div className="detail"><div className="row"><label className="search mside-search" style={{ margin: 0, flex: 1 }}><Icon n="search" s={12} /><input value={q} aria-label="Search the project" onChange={e => { S.wbSearch = e.target.value; emit() }} /></label><div className="segc"><button aria-pressed={!S.wbSem} onClick={run(() => { S.wbSem = false })}>Text</button><button aria-pressed={!!S.wbSem} onClick={run(() => { S.wbSem = true })}>By meaning</button></div></div>
    <p className="muted" style={{ fontSize: 12 }}>{plural(hits.length, 'match', 'matches')} in 3 files{S.wbSem ? ' · semantic index of 1,912 files' : ''}</p>
    {hits.filter(h => !q || h[2].toLowerCase().includes(q.toLowerCase()) || S.wbSem).map(([f, l, txt], i) => <button key={i} className="hit" onClick={run(() => { S.wbFile = f.split('/').pop()!; toast(`Opened ${f}:${l}`) })}><span className="mono">{f}<span className="muted">:{l}</span></span><span className="mono trunc">{txt}</span></button>)}</div></div>
}
function WorktreesPanel () {
  return <div className="scroll"><div className="detail"><p className="muted" style={{ fontSize: 13 }}>Worktrees of cajui-api. Each task can have its own; terminals can switch any of them.</p>
    <table className="ctable"><thead><tr><th>Branch</th><th>Path</th><th>Task</th><th>State</th><th /></tr></thead><tbody>{[['main', '~/code/cajui/cajui-api', '—', 'clean'], ['oxe/t142-idempotent-charges', '~/.oxespace/worktrees/cajui-api/t142', 'Make charge creation idempotent', '4 changed'], ['mig-prd', '~/.oxespace/worktrees/cajui-api/t143', 'Find why the monthly invoice report…', 'branch changed since'], ['oxe/t144-pix-webhooks', '~/.oxespace/worktrees/cajui-api/t144', 'Test Pix webhooks against the sandbox', '3 changed'], ['oxe/t137-rate-limit', '~/.oxespace/worktrees/cajui-api/t137', 'Rate-limit the public status… (merged)', 'can be removed']].map(([b, p, k, s]) => <tr key={p}><td className="mono">{b}</td><td className="mono muted2" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p}</td><td className="mono">{k}</td><td>{s === 'branch changed since' ? <span className="res attn">{s}</span> : s === 'can be removed' ? <span className="res ok">{s}</span> : s}</td><td>{s === 'can be removed' ? <button className="btn sm" onClick={run(() => toast('Removed the worktree; the branch stays'))}>Remove</button> : <button className="btn sm" onClick={run(() => toast(`New terminal in ${p}`))}><Icon n="term" s={12} /></button>}</td></tr>)}</tbody></table></div></div>
}
function BackgroundPanel () {
  return <div className="scroll"><div className="detail"><div className="row"><div className="segc"><button aria-pressed>Local jobs</button><button onClick={run(() => { S.overlay = { type: 'dlg', id: 'delegated' } })}>Delegated work</button></div><span className="sp" /><select className="sel" aria-label="Status"><option>Running (3)</option><option>Finished (9)</option><option>Failed (1)</option></select></div>
    <div className="slabel">Started by OXESpace</div>{[['npm run dev', 'Scripts · cajui-api', 'running · 31 min', true], ['npm run report:invoice', 'Scripts · cajui-api', 'finished 14:29 · exit 0', false]].map(([c, k, tm, live]) => <div key={c as string} className="script-r"><span className={'sdot ' + (live ? 'on' : 'off')} /><div><b className="mono">{c}</b><small>{k} · {tm}</small></div><span className="sp" />{live ? <button className="btn sm" onClick={run(() => toast(`Stopped ${c}`))}>Stop</button> : null}</div>)}
    <div className="slabel">Agents' background shells</div>{[['npm test -- charges', 'Make charge creation idempotent', '14:40'], ['tsc --watch', 'Make charge creation idempotent', '13:58']].map(([c, k, at]) => <div key={c} className="script-r"><span className="sdot wait" /><div><b className="mono">{c}</b><small>{k} · started {at} · state unknown</small></div><span className="sp" /><span className="muted" style={{ fontSize: 11 }}>Stop it from the conversation</span></div>)}</div></div>
}
export { Av, Kbd, MI, TermView, prov }
export type { AppState }
