/* Dialog catalog from the #569 audit, rebuilt on the U1 contract. Each entry is a spec rendered by <Dialog>. */
import { D } from '../mock/data'
import { S, emit, run, cur, plural, toast } from '../state/store'
import { Icon } from './ui'
import type { DialogSpec } from './Overlays'

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
    <table className="ctable"><thead><tr><th>Command</th><th>Task</th><th>Time</th><th /></tr></thead><tbody>
      {[['npm test -- charges', 'T-142', '1:12'], ['tsc --watch', 'T-142', '44 min'], ['docker compose logs -f api', 'T-144', '31 min']].map(([c, k, tm]) => <tr key={c}><td className="mono"><span className="spin" style={{ display: 'inline-block', verticalAlign: -2, marginRight: 6 }} />{c}</td><td className="mono">{k}</td><td className="mono">{tm}</td><td><button className="btn sm ghost" onClick={run(() => toast(`Stopped ${c}`))}>Stop</button></td></tr>)}</tbody></table></> }),
  archived: () => ({ size: 'md', icon: 'archive', title: 'Archived tasks', body: () => <div className="lst" style={{ padding: 0 }}>
    {[['T-131', 'Remove the legacy boleto endpoints', 'Oct 28'], ['T-127', 'Translate the merchant emails', 'Oct 24'], ['T-122', 'Investigate flaky e2e on CI', 'Oct 21']].map(([k, ti, d]) => <div key={k} className="li"><span className="trunc">{ti}</span><button className="btn sm" onClick={run(() => toast(`Restored ${k} to the task list`))}>Restore</button><span className="sub"><span className="mono">{k}</span> · archived {d}</span></div>)}
    <p className="muted" style={{ fontSize: 12, padding: 8 }}>11 more. Archived tasks keep their conversation and checkpoints.</p></div> }),
  report: () => ({ size: 'md', icon: 'warn', title: 'Report a problem', body: () => <>
    <div className="field"><label htmlFor="rp-what">What happened?</label><textarea className="input" id="rp-what" rows={4} placeholder="Opened T-143 and the task didn't load" /></div>
    <label className="row" style={{ fontSize: 13 }}><input type="checkbox" defaultChecked /> Include diagnostics (versions, last 200 log lines, no file contents)</label></>,
    extra: <button className="btn ghost" onClick={run(() => toast('Copied the report text'))}><Icon n="copy" s={12} />Copy text</button>, primary: { label: 'Open on GitHub', act: () => toast('Opens a new GitHub issue with the report') } }),
  finish: () => { const t = cur(); return { size: 'md', icon: 'branch', title: 'Finish the worktree', body: () => <>
    {text(`${t.branch} has ${plural((D.changes[t.id] || []).length, 'changed file')}. Choose what happens to it.`)}
    <div className="chips" role="radiogroup">{['Open a pull request', 'Merge into main locally', 'Keep the branch, remove the worktree'].map((l, i) => <button key={l} className="chip" role="radio" aria-pressed={(S.finishPick ?? 0) === i} aria-checked={(S.finishPick ?? 0) === i} onClick={run(() => { S.finishPick = i })}>{l}</button>)}</div>
    <div className="callout info"><Icon n="info" /><span>The worktree folder is removed after this. The branch and its commits stay.</span></div></>,
    primary: { label: 'Finish', act: () => { if ((S.finishPick ?? 0) === 0) { S.tab = 'pr' } else toast('Worktree finished') } } } },
  addproject: () => ({ size: 'md', icon: 'folder', title: 'Add a project', body: () => <>
    <div className="field"><label htmlFor="ap-path">Folder</label><div className="row"><input className="input mono" id="ap-path" defaultValue="~/code/cajui/cajui-docs" /><button className="btn" onClick={run(() => toast('Opens the system folder picker'))}>Browse…</button></div><span className="muted" style={{ fontSize: 12 }}>A git repository. OXESpace reads its branches and scripts.</span></div></>,
    primary: { label: 'Add project', act: () => toast('Added cajui-docs') } }),
  newws: () => ({ size: 'md', icon: 'plus', title: 'New workspace', body: () => <>
    <div className="field"><label htmlFor="nw-name">Name</label><input className="input" id="nw-name" placeholder="Personal" /></div>
    <div className="field"><label htmlFor="nw-path">Folder</label><div className="row"><input className="input mono" id="nw-path" defaultValue="~/code" /><button className="btn" onClick={run(() => toast('Opens the system folder picker'))}>Browse…</button></div></div></>,
    primary: { label: 'Create workspace', act: () => toast('Created the workspace (simulated)') } }),
}
