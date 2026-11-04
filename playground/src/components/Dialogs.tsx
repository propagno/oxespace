/* Dialog catalog from the #569 audit, rebuilt on the U1 contract. Each entry is a spec rendered by <Dialog>. */
import { D } from '../mock/data'
import { S, emit, run, cur, plural, toast, task, prov } from '../state/store'
import { Highlight } from './Tools'
import { goScreen } from '../screens/registry'
import { Icon, Av } from './ui'
import type { DialogSpec } from './Overlays'
import type { ReactNode } from 'react'
import { WORKSPACES, ensureWorkspace } from '../mock/workspaces'
import { panesOf } from './Modes'

const NW_PRESETS: [number, number, number][] = [[1, 1, 1], [2, 2, 1], [4, 2, 2], [6, 3, 2], [8, 4, 2], [10, 5, 2], [12, 4, 3], [14, 7, 2], [16, 4, 4]] // panes, cols, rows (1.4 LAYOUT_PRESETS)
/** 1.4's agent profiles on Windows, in its order (the shell chip comes first). */
const NW_AGENTS: [string, string][] = [['claude', 'Claude'], ['copilot', 'Copilot'], ['codex', 'Codex'], ['antigravity', 'Antigravity'], ['cursor', 'Cursor'], ['grok', 'Grok CLI']]

const text = (s: string) => <p style={{ color: 'var(--text-secondary)' }}>{s}</p>
export const EXTRA_DIALOGS: Record<string, () => DialogSpec> = {
  delegate: () => ({ size: 'md', icon: 'users', title: 'Delegate to a teammate', body: () => <>
    {text('Your teammate\'s agent continues this task on their machine with the same branch. You keep read access and see its progress here.')}
    <div className="field"><label htmlFor="dg-who">Teammate</label><select className="sel" id="dg-who"><option>Rafael Moura · online</option><option>Júlia Prado · away</option></select></div>
    <div className="field"><label htmlFor="dg-note">Note for them</label><textarea className="input" id="dg-note" rows={3} defaultValue="Can you take the invoice report from here? The fix is done; the staging data question is open." /></div>
    <div className="callout info"><Icon n="info" /><span>The branch is pushed so they can pull it. That push asks for your approval first.</span></div></>,
    primary: { label: 'Delegate', act: () => toast('Sent to Rafael. You\'ll be notified when they accept.') } }),
  mcp: () => ({ size: 'lg', icon: 'plug', title: 'MCP servers', body: () => <>
    {text('Servers give agents extra tools. Turning one on widens what an agent can do, so it applies at once with an undo.')}
    <div className="ssec">{D.mcp.map(m => { const on = m.builtin || S.set.mcpOn[m.name]
      return <div key={m.name} className="srow"><div className="l"><b><span className={'sdot ' + (m.status === 'err' ? 'bad' : on ? 'on' : 'off')} />{m.name}{m.builtin ? <span className="pill neutral">built in</span> : null}</b><p>{m.status === 'err' ? <span style={{ color: 'var(--danger-fg)' }}>{m.err}. Sign in again to use it.</span> : `${m.desc} · ${plural(m.tools, 'tool')}`}</p></div>
        <div className="ra">{m.status === 'err' ? <button className="btn sm" onClick={run(() => toast('Opened the Sentry sign-in in your browser'))}>Sign in</button> : null}<button className={'tg-sw' + (on ? '' : ' risk')} role="switch" aria-checked={!!on} aria-label={`Turn ${m.name} ${on ? 'off' : 'on'}`} disabled={m.builtin}
          onClick={run(() => { S.set.mcpOn[m.name] = !on; toast(`${m.name} turned ${on ? 'off' : 'on'}`, { undo: () => { S.set.mcpOn[m.name] = !!on; emit() } }) })} /></div></div> })}</div></>,
    extra: <button className="btn ghost" onClick={run(() => toast('In the app this opens the server catalog'))}><Icon n="plus" s={12} />Add server</button> }),
  background: () => ({ size: 'md', icon: 'activity', title: 'Background activity', body: () => <>
    <div className="row"><span className="slabel">Status</span><select className="sel" style={{ height: 28 }} aria-label="Status"><option>Running (3)</option><option>Finished today (9)</option><option>Failed (1)</option></select></div>
    <table className="ctable"><thead><tr><th>Command</th><th>Started by</th><th>State</th><th /></tr></thead><tbody>
      {[['npm run dev', 'OXESpace · Scripts', 'running · 31 min', true], ['npm test -- charges', 'Make charge creation idempotent', 'started 14:40 · state unknown', false], ['tsc --watch', 'Make charge creation idempotent', 'started 13:58 · state unknown', false]].map(([c, k, st, ours]) => <tr key={c as string}><td className="mono">{c}</td><td>{k}</td><td>{st}</td><td>{ours ? <button className="btn sm ghost" onClick={run(() => toast(`Stopped ${c}`))}>Stop</button> : null}</td></tr>)}</tbody></table></> }),
  archived: () => ({ size: 'md', icon: 'archive', title: 'Archived tasks', body: () => <div className="lst" style={{ padding: 0 }}>
    {[['T-131', 'Remove the legacy boleto endpoints', 'Oct 28'], ['T-127', 'Translate the merchant emails', 'Oct 24'], ['T-122', 'Investigate flaky e2e on CI', 'Oct 21']].map(([k, ti, d]) => <div key={k} className="li"><span className="trunc">{ti}</span><button className="btn sm" onClick={run(() => toast(`Restored ${k} to the task list`))}>Restore</button><span className="sub"><span className="mono">{k}</span> · archived {d}</span></div>)}
    <p className="muted" style={{ fontSize: 12, padding: 8 }}>11 more. Archived tasks keep their conversation and checkpoints.</p></div> }),
  report: () => ({ size: 'md', icon: 'warn', title: 'Report a problem', body: () => <>
    <div className="field"><label htmlFor="rp-what">What happened?</label><textarea className="input" id="rp-what" rows={4} placeholder="Opened the invoice report conversation and it didn't load" /></div>
    <label className="row" style={{ fontSize: 13 }}><input type="checkbox" defaultChecked /> Include diagnostics (versions, last 200 log lines, no file contents)</label></>,
    extra: <button className="btn ghost" onClick={run(() => toast('Copied the report text'))}><Icon n="copy" s={12} />Copy text</button>, primary: { label: 'Open on GitHub', act: () => toast('Opens a new GitHub issue with the report') } }),
  finish: () => { const t = cur(); return { size: 'md', icon: 'branch', title: 'Finish the worktree', body: () => <>
    {text(`${t.branch} has ${plural((D.changes[t.id] || []).length, 'changed file')}. Choose what happens to it.`)}
    <div className="chips" role="radiogroup">{['Open a pull request', 'Merge into main locally', 'Keep the branch, remove the worktree'].map((l, i) => <button key={l} className="chip" role="radio" aria-pressed={(S.finishPick ?? 0) === i} aria-checked={(S.finishPick ?? 0) === i} onClick={run(() => { S.finishPick = i })}>{l}</button>)}</div>
    <div className="callout info"><Icon n="info" /><span>The worktree folder is removed after this. The branch and its commits stay.</span></div></>,
    primary: { label: 'Finish', act: () => { if ((S.finishPick ?? 0) === 0) { S.tab = 'pr' } else toast('Worktree finished') } } } },
  // 1.4's Add project: an empty "Project folder path" and Browse; nothing prefilled.
  addproject: () => ({ size: 'md', icon: 'folder', title: 'Add project', body: () => <>
    <div className="field"><label htmlFor="ap-path">Project folder path</label><div className="row"><input className="input mono" id="ap-path" placeholder="C:/projects/my-app" value={S.apPath || ''} onChange={e => { S.apPath = e.target.value; emit() }} /><button className="btn" onClick={run(() => { S.apPath = '~/code/cajui/cajui-docs'; toast('The system folder picker opens here; the playground picks cajui-docs') })}><Icon n="folder" s={12} />Browse</button></div></div></>,
    primary: { label: 'Add project', disabled: !(S.apPath || '').trim(), act: () => { toast(`Added ${(S.apPath || '').trim().split('/').pop()}`); S.apPath = undefined } } }),
  // 1.4's NewWorkspaceModal, exactly (the user's fixed constraint): folder (empty, Browse), layouts 1–16 with a
  // preview, the shell chip and every agent profile with ± and the slot counter, Clear selection, and "Open existing
  // workspace" when the folder already has one. Create makes the card with its panes and selects it.
  newws: () => { const nw = (S.nw ||= { path: '', layout: 4, agents: {}, shell: 0 }); const path = nw.path.trim()
    const existing = path ? WORKSPACES.filter(w => w.path === path && !S.wsGone?.includes(w.id)) : []
    const filled = Object.values(nw.agents).reduce((a, b) => a + b, 0) + nw.shell; const remaining = Math.max(0, nw.layout - filled); const full = filled >= nw.layout
    const base = path ? path.split(/[\\/]/).filter(Boolean).pop() : null
    const chip = (id: string, name: string, icon: ReactNode, count: number, inc: () => void, dec: () => void) => <div key={id} className={'nw-chip' + (count ? ' selected' : '')}>
      <button type="button" className="nw-chip-b" onClick={run(inc)} disabled={!count && full} aria-label={`Add ${name}`}>{icon}<span>{name}</span></button>
      <span className="nw-chip-c" aria-live="polite"><button type="button" className="ibtn sm" onClick={run(dec)} disabled={count <= 0} aria-label={`Remove one ${name}`}><Icon n="min" s={12} /></button><span className="mono">{count}</span><button type="button" className="ibtn sm" onClick={run(inc)} disabled={full} aria-label={`Add another ${name}`}><Icon n="plus" s={12} /></button></span></div>
    return { size: 'lg', icon: 'plus', extra: !path ? <span className="muted" style={{ fontSize: 12 }}>Choose a folder to continue.</span> : undefined, title: existing.length ? 'Open existing workspace' : 'Create new workspace', body: () => <>
      <p style={{ color: 'var(--text-secondary)' }}>{existing.length ? 'Choose the workspace to continue where you left off.' : 'Pick a folder, a layout and, if you want, agents.'}</p>
      <section className="nw-sec"><div className="nw-st">Folder</div><div className={'nw-zone' + (path ? ' has' : '')}><span className="nw-zi" aria-hidden="true"><Icon n={path ? 'check' : 'folder'} s={16} /></span>
        <div className="nw-zm">{path ? <span className="nw-zn">{base}</span> : <span className="nw-zp">Choose a project folder</span>}<input className="input mono" placeholder="C:/projects/my-app" value={nw.path} aria-label="Workspace folder path" spellCheck={false} onChange={e => { nw.path = e.target.value; emit() }} /></div>
        <button className="btn" onClick={run(() => { nw.path = '~/.oxespace/worktrees/cajui-api/t147'; toast('The system folder picker opens here; the playground picks a worktree folder') })}><Icon n="folder" s={12} />Browse</button></div></section>
      {existing.length ? <section className="nw-sec"><div className="nw-st">Already open in OxeCode</div><p className="muted">This folder already has a workspace. Opening it keeps its terminals and layout.</p></section> : <>
        <section className="nw-sec"><div className="nw-st">Layout</div><div className="nw-lay" role="radiogroup" aria-label="Layout preset">{NW_PRESETS.map(([n, c, r]) => <button key={n} role="radio" aria-checked={nw.layout === n} title={n === 1 ? 'One terminal' : n === 2 ? 'Side by side' : `${r}×${c} grid`} className={'nw-lc' + (nw.layout === n ? ' selected' : '')} onClick={run(() => { nw.layout = n })}>
          <span className="nw-pv" style={{ gridTemplateColumns: `repeat(${c}, 1fr)`, gridTemplateRows: `repeat(${r}, 1fr)` }} aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} />)}</span><span>{n === 1 ? '1 pane' : `${n} panes`}</span></button>)}</div></section>
        <section className="nw-sec"><div className="nw-st"><span>Agents</span><span className="nw-badge">{filled}/{nw.layout} slots filled</span>{remaining ? <span className="nw-badge muted">{remaining === 1 ? '1 default shell' : `${remaining} default shells`}</span> : null}</div>
          <div className="nw-chips">{chip('shell', 'PowerShell', <Icon n="term" s={12} />, nw.shell, () => { if (!full) nw.shell++ }, () => { nw.shell = Math.max(0, nw.shell - 1) })}
            {NW_AGENTS.map(([id, name]) => chip(id, name, id === 'claude' || id === 'codex' ? <Av p={id} size="s16" /> : <span className="nw-ai" aria-hidden="true">{name[0]}</span>, nw.agents[id] || 0, () => { if (!full) nw.agents[id] = (nw.agents[id] || 0) + 1 }, () => { nw.agents[id] = Math.max(0, (nw.agents[id] || 0) - 1) }))}</div>
          {filled ? <button className="btn ghost sm nw-clear" onClick={run(() => { nw.agents = {}; nw.shell = 0 })}>Clear selection</button> : null}</section></>}</>,
      primary: { label: existing.length ? 'Open workspace' : 'Create workspace', disabled: !path, act: () => {
        if (existing.length) { S.ws = existing[0].id; S.area = 'mode'; S.mode2 = 'code'; S.nw = undefined; return }
        const m = /worktrees\/([^/]+)\/([^/]+)$/.exec(path) || /code\/cajui\/([^/]+)$/.exec(path); const proj = m && Object.values(D.projects).find(x => x.name === m[1])
        if (!proj) { toast(`Created the workspace ${base} (simulated: the playground only knows the cajui folders)`); S.nw = undefined; return }
        const [w] = ensureWorkspace(proj.id, proj.name, m![2] || 'main'); const panes = panesOf(w.id); const slots: [string, string][] = []
        NW_AGENTS.forEach(([id, name]) => { for (let i = 0; i < (nw.agents[id] || 0); i++) slots.push([id, name]) })
        for (let i = 0; i < nw.layout; i++) { const a = slots[i]; panes.push({ id: 'nw' + Date.now() + i, name: a ? a[0] : 'pwsh', shell: a ? a[0] : 'pwsh', prov: a && (a[0] === 'claude' || a[0] === 'codex') ? a[0] : undefined, cwd: w.path, by: 'you', branch: w.branch, project: proj.name, lines: a ? [['dim', `${a[1]} started in ${w.path}`]] : [] }) }
        S.ws = w.id; S.code.focus = 0; S.codeLayout = ({ 1: '1x1', 2: '1x2', 4: '2x2', 6: '2x3', 8: '2x4', 10: '2x5', 12: '3x4', 14: '2x7', 16: '4x4' } as Record<number, string>)[nw.layout]; S.area = 'mode'; S.mode2 = 'code'; (S.wsOpen ||= {})[w.id] = true
        toast(`Created ${w.name} with ${nw.layout === 1 ? '1 terminal' : nw.layout + ' terminals'}`); S.nw = undefined } } } },
  newconn: () => ({ size: 'md', icon: 'db', title: 'New connection', body: () => <>
    <div className="row" style={{ alignItems: 'start' }}><div className="field" style={{ flex: 1 }}><label htmlFor="nc-name">Name</label><input className="input" id="nc-name" placeholder="billing-staging" /></div><div className="field" style={{ width: 170 }}><label htmlFor="nc-eng">Database</label><select className="sel" id="nc-eng"><option>Postgres</option><option>MySQL</option><option>SQLite</option><option>SQL Server</option><option>ClickHouse</option></select></div></div>
    <div className="row"><div className="field" style={{ flex: 1 }}><label htmlFor="nc-host">Host</label><input className="input mono" id="nc-host" defaultValue="staging-db.cajui.internal" /></div><div className="field" style={{ width: 90 }}><label htmlFor="nc-port">Port</label><input className="input mono" id="nc-port" defaultValue="5432" /></div></div>
    <div className="row"><div className="field" style={{ flex: 1 }}><label htmlFor="nc-user">User</label><input className="input" id="nc-user" defaultValue="marina" /></div><div className="field" style={{ flex: 1 }}><label htmlFor="nc-pw">Password</label><input className="input" id="nc-pw" type="password" defaultValue="••••••••" /></div></div>
    <div className="field"><label>Environment</label><div className="chips">{['local', 'staging', 'production'].map(e => <button key={e} className={'chip' + (e === 'production' ? ' dz' : '')} aria-pressed={(S.ncEnv ?? 'staging') === e} onClick={run(() => { S.ncEnv = e })}>{e}</button>)}</div></div>
    <div className="field"><label htmlFor="nc-agent">What agents may do here</label><select className="sel" id="nc-agent" defaultValue="confirm"><option value="off">Nothing</option><option value="read">Read</option><option value="confirm">Read, and ask before writing</option><option value="write">Read and write</option></select></div>
    <details><summary className="muted" style={{ fontSize: 12 }}>Advanced: TLS and SSH tunnel</summary><div className="row" style={{ marginTop: 8 }}><label className="row" style={{ fontSize: 13 }}><input type="checkbox" defaultChecked /> Require TLS</label><label className="row" style={{ fontSize: 13 }}><input type="checkbox" /> Connect through SSH</label></div></details></>,
    extra: <button className="btn ghost" onClick={run(() => toast('Connected in 84 ms. Postgres 16.4, 42 tables.'))}>Test</button>, primary: { label: 'Save connection', act: () => toast('Saved billing-staging') } }),
  oqsettings: () => ({ size: 'md', icon: 'gear', title: 'OxeQuery settings', body: () => <>
    <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Limits per environment. They apply to you and to agents.</p>
    <table className="ctable"><thead><tr><th>Environment</th><th>Rows returned</th><th>Statement time</th></tr></thead><tbody>{[['local', '10,000', '60 s'], ['staging', '5,000', '30 s'], ['production', '500', '10 s']].map(([e, r, t]) => <tr key={e}><td><span className={'env ' + e}>{e}</span></td><td><input className="input mono" defaultValue={r} style={{ width: 100, padding: '3px 8px' }} aria-label={`Rows for ${e}`} /></td><td><input className="input mono" defaultValue={t} style={{ width: 80, padding: '3px 8px' }} aria-label={`Time for ${e}`} /></td></tr>)}</tbody></table></>,
    primary: { label: 'Save', act: () => toast('Saved the limits') } }),
  qrow: () => { const q = D.queries.find(x => x.id === S.overlay!.q)!; const t = task(q.task); const pend = q.status === 'pending' && !S.resolved.ap_sql
    return { size: 'lg', icon: 'db', title: `${q.kind === 'read' ? 'Query' : q.kind === 'ddl' ? 'Schema change' : 'Write'} by ${prov(q.by).name}`, body: () => <>
      <dl className="kv"><dt>Task</dt><dd>{t ? t.title : 'Explain the settlement batch job'}</dd><dt>Connection</dt><dd>{q.conn}</dd><dt>When</dt><dd>{q.at}</dd><dt>Result</dt><dd>{q.status === 'ok' ? `${plural(q.rows, 'row')} in ${q.ms} ms` : pend ? 'Waiting for your approval' : q.status === 'denied' ? 'Not run: ' + q.note : S.resolved.ap_sql === 'deny' ? 'Denied by you' : '1,284 rows changed in 3.4 s'}</dd></dl>
      <pre className="code"><Highlight s={q.sql} /></pre>
      {q.cols.length ? <div className="tbl-wrap"><table className="grid-t"><thead><tr>{q.cols.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{q.data.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div> : null}</>,
      extra: t ? <button className="btn ghost" onClick={() => { S.overlay = null; S.taskId = q.task; S.tab = 'conv'; goScreen('task-current') }}>Open the task</button> : undefined,
      primary: pend ? { label: 'See impact', act: () => { setTimeout(() => { S.overlay = { type: 'approve', id: 'ap_sql' }; emit() }, 0) } } : undefined } },
  prow: () => { const r = D.requests[S.overlay!.r!]; const t = task(r.task!)
    return { size: 'lg', icon: 'net', title: `${r.method} ${r.name}`, body: () => <>
      <dl className="kv"><dt>Task</dt><dd>{t?.title}</dd><dt>Agent</dt><dd>{prov(r.by!).name}</dd><dt>When</dt><dd>{r.at}</dd><dt>Result</dt><dd>{r.blocked ? 'Blocked by policy before sending' : `${r.status} in ${r.ms} ms · ${r.size}`}</dd></dl>
      <pre className="code">{r.method} {r.url}{'\n'}{r.headers.map(h => h.join(': ')).join('\n')}{r.reqBody ? '\n\n' + r.reqBody : ''}</pre>
      {r.resBody ? <pre className="code">{r.resBody}</pre> : null}</>,
      extra: t ? <button className="btn ghost" onClick={() => { S.overlay = null; S.taskId = r.task!; S.post.req = r.id; S.tab = 'requests'; goScreen('task-current') }}>Open the task</button> : undefined } },
  import: () => ({ size: 'md', icon: 'upload', title: 'Import requests', body: () => <>
    <div className="chips">{['Postman collection', 'OpenAPI 3', 'cURL', 'Insomnia'].map((x, i) => <button key={x} className="chip" aria-pressed={(S.impPick ?? 0) === i} onClick={run(() => { S.impPick = i })}>{x}</button>)}</div>
    <div className="state" style={{ border: '1px dashed var(--border-default)', borderRadius: 10, padding: 24 }}><p style={{ fontSize: 13 }}>Drop a file here, or <button className="lk" onClick={run(() => toast('Opens the system file picker'))}>choose one</button>.</p></div></>,
    primary: { label: 'Import', disabled: true, act: () => {} } }),
  envs: () => ({ size: 'lg', icon: 'layers', title: 'Environments', body: () => <>
    <div className="callout warn"><Icon n="key" /><span>Secrets aren't stored here. Reference them as <span className="mono">{'{{secret:NAME}}'}</span>; they come from your keychain and agents never see them.</span></div>
    {D.envs.map(e => <div key={e.id} className="ssec"><div className="ssec-h"><h2>{e.name}</h2>{e.locked ? <span className="acc off">Agents can't use it</span> : null}</div>{e.vars.map(([k, v]) => <div key={k} className="srow" style={{ padding: '6px 16px' }}><span className="mono" style={{ fontSize: 12 }}>{k}</span><span className="mono muted" style={{ fontSize: 12 }}>{v}</span></div>)}</div>)}</>,
    extra: <button className="btn ghost" onClick={run(() => toast('Added an empty environment'))}><Icon n="plus" s={12} />New environment</button>, cancel: 'Done' }),
  podremove: () => { const c = D.containers.find(x => x.id === S.overlay!.c)!; return { size: 'sm', icon: 'trash', title: `Remove ${c.name}?`, safeFirst: true, body: () => <p style={{ color: 'var(--text-secondary)' }}>The container is deleted. {c.vol ? <>Its volume <span className="mono">{c.vol}</span> is kept.</> : null} This can't be undone.</p>, primary: { label: 'Remove container', danger: true, act: () => toast(`Removed ${c.name}`) } } },
  poddown: () => { const c = D.containers.find(x => x.id === S.pod.sel) || D.containers[0]; return { size: 'sm', icon: 'box', title: `Stop the ${c.stack} stack?`, safeFirst: true, body: () => <p style={{ color: 'var(--text-secondary)' }}>Runs <span className="mono">docker compose down</span>: every container in {c.stack} stops and is removed. Volumes are kept.</p>, primary: { label: 'Stop the stack', danger: true, act: () => toast(`Stopped ${c.stack}`) } } },
}
