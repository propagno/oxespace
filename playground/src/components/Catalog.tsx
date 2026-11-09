/* The rest of the #569 dialog inventory on the U1 contract, and a gallery that opens each one. */
import { D } from '../mock/data'
import { S, emit, run, toast, plural, resolve } from '../state/store'
import { Icon, Av, Kbd } from './ui'
import type { DialogSpec } from './Overlays'
import { KEYS } from './Settings'
import { addPane, focusedPlace } from './Modes'
import { agents, stopAgent } from './Agora'

const p = (s: string) => <p style={{ color: 'var(--text-secondary)' }}>{s}</p>
function QR () { // a stand-in pairing code, drawn from a fixed pattern
  const cells: boolean[] = []; let x = 7
  for (let i = 0; i < 625; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; cells.push((x >> 16) % 3 === 0) }
  const finder = (r: number, c: number) => [[0, 0], [0, 18], [18, 0]].some(([a, b]) => r >= a && r < a + 7 && c >= b && c < b + 7)
  return <svg viewBox="0 0 25 25" width="168" height="168" role="img" aria-label="Pairing code" style={{ background: '#fff', padding: 8, borderRadius: 8 }} shapeRendering="crispEdges">
    {cells.map((on, i) => { const r = Math.floor(i / 25), c = i % 25; if (finder(r, c)) { const a = r < 7 ? 0 : 18, b = c < 7 ? 0 : 18, rr = r - a, cc = c - b; const f = rr === 0 || rr === 6 || cc === 0 || cc === 6 || (rr > 1 && rr < 5 && cc > 1 && cc < 5); return f ? <rect key={i} x={c} y={r} width="1" height="1" fill="#0d100e" /> : null } return on ? <rect key={i} x={c} y={r} width="1" height="1" fill="#0d100e" /> : null })}</svg>
}

export const MORE_DIALOGS: Record<string, () => DialogSpec> = {
  agstop: () => { const a = agents().find(x => x.id === S.agStop); return { size: 'sm', icon: 'stop', title: `Stop "${a?.title}"?`, body: () => p('The agent stops after the command it is running. The work so far, its files and its checkpoints are kept; send a message to continue.'), safeFirst: true, primary: { label: 'Stop the agent', danger: true, act: stopAgent } } },
  removeproj: () => { const pr = D.projects[S.projCtx || 'api']; return { size: 'sm', icon: 'trash', title: 'Remove this project?', body: () => p(`Remove "${pr.name}" from the OxeChat sidebar? Its conversations, files and OxeCode workspaces remain. Restore this project individually from Removed projects or add its folder again.`), safeFirst: true, primary: { label: 'Remove project', danger: true, act: () => { (S.removedProj ||= []).push(pr.id); toast(`Removed ${pr.name} from the sidebar`, { undo: () => { S.removedProj = S.removedProj!.filter((x: string) => x !== pr.id); emit() } }) } } } },
  newpane: () => { const kind = S.overlay!.text; const d = focusedPlace(); const sel = (S.npSel ||= { project: d.project, wt: d.wt })
    return { size: 'sm', icon: kind === 'agent' ? 'sparkle' : 'term', title: kind === 'agent' ? 'New agent pane' : 'New terminal', body: () => <>
      <div className="field"><label htmlFor="np-p">Project</label><select className="sel" id="np-p" value={sel.project} onChange={e => { sel.project = e.target.value; sel.wt = 'main'; emit() }}><option>cajui-api</option><option>cajui-web</option></select></div>
      <div className="field"><label htmlFor="np-w">Worktree</label><select className="sel" id="np-w" value={sel.wt} onChange={e => { sel.wt = e.target.value; emit() }}>{(sel.project === 'cajui-api' ? ['main', 't142', 't143', 't144', 't147'] : ['main']).map(w => <option key={w} value={w}>{w === 'main' ? 'main checkout' : `${w} · its conversation's worktree`}</option>)}</select></div>
      <p className="muted" style={{ fontSize: 12 }}>Defaults to where the focused pane is.</p></>,
      primary: { label: kind === 'agent' ? 'Start Claude Code' : 'Open terminal', act: () => { addPane(kind!, sel.project, sel.wt); S.npSel = undefined } } } },
  delegated: () => ({ size: 'lg', icon: 'users', title: 'Delegated work', body: () => <table className="ctable"><thead><tr><th>Task</th><th>Who</th><th>State</th><th>Updated</th></tr></thead><tbody>{[['T-136 Translate merchant emails', 'Rafael Moura · Claude', 'Running', '14:20'], ['T-130 Fix flaky e2e', 'Júlia Prado · Codex', 'Waiting for them', 'Yesterday'], ['T-128 Settlement report v2', 'Rafael Moura · Claude', 'Done · PR #306', 'Mon']].map(r => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2] === 'Running' ? <span className="res ok">{r[2]}</span> : r[2]}</td><td className="mono">{r[3]}</td></tr>)}</tbody></table> }),
  accounts: () => ({ size: 'md', icon: 'key', title: 'Agent accounts', body: () => <>
    {Object.values(D.providers).map(pv => <div key={pv.id} className="ssec"><div className="srow"><div className="l"><b><Av p={pv.id} size="s16" />{pv.name}</b><p>{pv.account} · {pv.plan} plan</p></div><div className="ra"><span className="res ok">Connected</span><button className="btn sm ghost" onClick={run(() => toast(`Signed out of ${pv.name}`, { undo: () => {} }))}>Sign out</button></div></div></div>)}
    <div className="callout info"><Icon n="info" /><span>Each CLI keeps its own sign-in. OXESpace never sees your password.</span></div></> }),
  newagent: () => ({ size: 'md', icon: 'sparkle', title: 'New custom agent', body: () => <>
    <div className="field"><label htmlFor="na-name">Name</label><input className="input" id="na-name" placeholder="Migration reviewer" /></div>
    <div className="field"><label htmlFor="na-ins">Instructions</label><textarea className="input" id="na-ins" rows={4} placeholder="Review Postgres migrations for locks, missing indexes and irreversible steps." /></div>
    <div className="row"><div className="field" style={{ flex: 1 }}><label htmlFor="na-model">Model</label><select className="sel" id="na-model"><option>Sonnet 5.5</option><option>Opus 5.5</option><option>Haiku 5.5</option></select></div><div className="field" style={{ flex: 1 }}><label htmlFor="na-acc">Access</label><select className="sel" id="na-acc"><option>Read only</option><option>Can edit</option></select></div></div></>,
    primary: { label: 'Create agent', act: () => toast('Created the agent') } }),
  pair: () => ({ size: 'md', icon: 'phone', title: (S.pairStep ?? 0) === 1 ? 'Pair Pixel 8a · Marina?' : 'Pair a phone', body: () => (S.pairStep ?? 0) === 1
    ? <><p style={{ color: 'var(--text-secondary)' }}>A phone asked to pair. Pair only if the phone shows the same code:</p><div className="paircode">K7Q M4Z</div><p className="muted" style={{ fontSize: 12 }}>Refuse if you didn't start this.</p></>
    : <div className="row" style={{ alignItems: 'start', gap: 20 }}><div className="stack" style={{ gap: 6, width: 168 }}><QR /><p className="muted" style={{ fontSize: 11 }}>Certificate fingerprint · The phone checks this before it trusts the connection.<br /><span className="mono">3F:A9:0C:71:…:5E:22</span></p></div>
      <div className="stack" style={{ gap: 8 }}><ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, color: 'var(--text-secondary)' }}><li>Open OXESpace on your Android phone, on the same Wi-Fi.</li><li>Tap <b>Pair with your computer</b> and scan this code.</li><li>Check that both show <span className="mono" style={{ color: 'var(--text-primary)' }}>K7Q M4Z</span>.</li></ol>
        <p className="muted" style={{ fontSize: 12 }}>The code expires in 1:52. <button className="lk" onClick={run(() => toast('Showed a new code'))}>Show a new code</button></p>
        <button className="btn sm" style={{ justifySelf: 'start' }} onClick={run(() => { S.pairStep = 1 })}>Simulate: the phone scanned it</button></div></div>,
    safeFirst: (S.pairStep ?? 0) === 1, cancel: (S.pairStep ?? 0) === 1 ? 'Refuse' : 'Cancel',
    primary: (S.pairStep ?? 0) === 1 ? { label: 'Pair', act: () => { S.pairStep = 0; toast('Paired Pixel 8a · Marina') } } : undefined }),
  unpair: () => { const n = S.overlay!.c!; return { size: 'sm', icon: 'phone', title: `Unpair ${n}?`, safeFirst: true, body: () => p('The phone loses access at once and its key is revoked. To use it again you pair it from scratch.'), primary: { label: 'Unpair', danger: true, act: () => { (S.unpaired ||= []).push(n); toast(`Unpaired ${n}`) } } } },
  driftback: () => ({ size: 'sm', icon: 'branch', title: `Switch the worktree back to ${S.overlay!.text}?`, safeFirst: true, body: () => p('Runs git switch in this worktree. Your terminal there will be on the old branch again; anything it was doing on mig-prd stays on mig-prd.'), primary: { label: 'Switch back', act: () => toast(`Switched back to ${S.overlay?.text || 'the task branch'}`) } }),
  driftfollow: () => ({ size: 'sm', icon: 'branch', title: 'Follow the new branch?', safeFirst: true, body: () => p(`This conversation will compare its changes with ${S.overlay!.text}. The changes made before the switch stay in Checkpoints.`), primary: { label: 'Follow', act: () => toast('This conversation now follows mig-prd') } }),
  irrev: () => { const ap = D.approvals[S.overlay!.text!]; return { size: 'sm', icon: 'warn', title: 'Approve without holding', body: () => <><p style={{ color: 'var(--text-secondary)' }}>{ap.title}. {ap.undoSub}.</p><label className="row" style={{ fontSize: 13 }}><input type="checkbox" checked={!!S.irrevOk} onChange={e => { S.irrevOk = e.target.checked; emit() }} /> I understand this can't be undone</label></>, safeFirst: true, primary: { label: 'Approve', danger: true, disabled: !S.irrevOk, act: () => { S.irrevOk = false; resolve(ap.id, 'ok') } } } },
  clearhistory: () => ({ size: 'sm', icon: 'trash', title: 'Clear history?', safeFirst: true, body: () => p('Deletes 14 archived tasks, their conversations and checkpoints (2.1 GB). Open and pinned tasks stay. This can\'t be undone.'), primary: { label: 'Clear history', danger: true, act: () => toast('History cleared') } }),
  about: () => ({ size: 'sm', icon: 'info', title: 'About OXESpace', body: () => <><div className="row"><span className="logo" style={{ width: 32, height: 32 }} /><div><b style={{ font: '700 16px var(--f-display)' }}>OXESpace 1.5.0</b><p className="muted" style={{ fontSize: 12 }}>Electron 39 · Node 22.11 · Windows 11 · build 2026.11.03</p></div></div><p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Made in Recife. Mandacaru design system. 174 open-source packages; their licenses are in THIRD_PARTY_NOTICES.</p></>,
    extra: <button className="btn ghost" onClick={run(() => toast('Copied the version details'))}><Icon n="copy" s={12} />Copy details</button> }),
  shortcuts: () => ({ size: 'md', icon: 'keyboard', title: 'Keyboard shortcuts', body: () => <div className="keys" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', fontSize: 13 }}>{KEYS.map(([a, k]) => <span key={a} style={{ display: 'contents' }}><span>{a}</span><Kbd>{k}</Kbd></span>)}</div> }),
  usage: () => ({ size: 'md', icon: 'activity', title: 'Usage', body: () => <>{Object.values(D.providers).map(pv => <div key={pv.id} className="ssec"><div className="srow wide"><div className="l"><b><Av p={pv.id} size="s16" />{pv.name} · {pv.plan}</b><p>{pv.id === 'claude' ? 'Claude account · 5 h window resets at 17:20' : 'ChatGPT account · weekly limit resets Monday'}</p></div>
    <div className="meter"><i style={{ width: pv.id === 'claude' ? '41%' : '18%' }} /></div><p className="muted" style={{ fontSize: 12 }}>{pv.id === 'claude' ? '41% used · $3.89 today across 5 tasks' : '18% used · about $0.84 today (estimated from tokens)'}</p></div></div>)}</> }),
  unsaved: () => ({ size: 'sm', icon: 'warn', title: 'Close with unsaved work?', safeFirst: true, body: () => p('open-invoices.sql in OxeQuery has changes that aren\'t saved.'), cancel: 'Keep working', primary: { label: 'Close without saving', danger: true, act: () => toast('Closed (simulated)') } }),
  termrestore: () => ({ size: 'md', icon: 'term', title: 'Restore your terminals?', body: () => <>{p('OXESpace closed with 4 terminals open. Restore them where they were?')}
    <div className="lst" style={{ padding: 0 }}>{['api · npm run dev', 'tests · npm test -- charges (agent)', 'report · cajui-api/t143', 'claude · cajui-web'].map(t => <label key={t} className="row" style={{ fontSize: 13, padding: '4px 0' }}><input type="checkbox" defaultChecked />{t}</label>)}</div></>, cancel: 'Start fresh', primary: { label: 'Restore 4 terminals', act: () => toast('Restored 4 terminals') } }),
  command: () => ({ size: 'md', icon: 'slash', title: 'Run /review', body: () => <><div className="field"><label htmlFor="cm-scope">What to review</label><select className="sel" id="cm-scope"><option>Changes in this task (4 files)</option><option>Only staged changes</option></select></div><div className="field"><label htmlFor="cm-focus">Focus (optional)</label><input className="input" id="cm-focus" placeholder="Race conditions, missing tests" /></div></>, primary: { label: 'Run', act: () => toast('/review sent to the agent') } })
}

const GROUPS: [string, [string, string, string, string][]][] = [
  ['Tasks and conversation', [['newtask', 'New task', 'md', 'U5a'], ['rename', 'Rename task', 'sm', 'U5a'], ['deletetask', 'Delete task', 'sm', 'T58 §7b'], ['restore', 'Restore files to a checkpoint', 'md', 'C'], ['branch', 'Branch from a checkpoint', 'md', 'C'], ['fullaccess', 'Give full access', 'sm', 'T58 §4.3'], ['delegate', 'Delegate to a teammate', 'md', 'U5c'], ['command', 'Run a slash command', 'md', 'U5a'], ['background', 'Background activity', 'md', 'G-05'], ['delegated', 'Delegated work', 'lg', 'Delegation'], ['archived', 'Archived tasks', 'md', 'U5a']]],
  ['Approvals', [['approve:ap_sql', 'Impact preview: database write', 'lg', 'T67'], ['approve:ap_down', 'Impact preview: delete a volume', 'lg', 'T67'], ['approve:ap_push', 'Impact preview: git push', 'lg', 'T67']]],
  ['Changes', [['discard', 'Discard all changes', 'sm', 'U5a'], ['finish', 'Finish the worktree', 'md', 'U5a']]],
  ['OxeQuery', [['newconn', 'New connection', 'md', 'Q-02, A5'], ['oqsettings', 'OxeQuery settings', 'md', 'Q-03'], ['qrow', 'What an agent ran', 'lg', 'T63']]],
  ['Containers', [['podremove', 'Remove a container', 'sm', 'P1'], ['poddown', 'Stop a stack', 'sm', 'P1']]],
  ['App', [['mcp', 'MCP servers', 'lg', 'G-03'], ['accounts', 'Agent accounts', 'md', 'G-07'], ['usage', 'Usage', 'md', 'G-06'], ['newagent', 'New custom agent', 'md', 'X10'], ['pair', 'Pair a phone', 'md', 'U5c'], ['unpair', 'Unpair a phone', 'sm', 'U2'], ['clearhistory', 'Clear history', 'sm', 'U2'], ['report', 'Report a problem', 'md', 'G-09'], ['about', 'About', 'sm', 'U5c'], ['shortcuts', 'Keyboard shortcuts', 'md', 'U5c'], ['unsaved', 'Unsaved work', 'sm', 'U5c'], ['termrestore', 'Restore terminals', 'md', 'U5c'], ['addproject', 'Add a project', 'md', 'D-06'], ['newws', 'New workspace', 'md', 'D-06'], ['removews', 'Remove workspace', 'sm', 'G-08']]]
]
export function DialogGallery () {
  const open = (id: string) => run(() => {
    if (id.startsWith('approve:')) { S.overlay = { type: 'approve', id: id.slice(8) }; return }
    if (id === 'newtask') { S.overlay = { type: 'newtask', text: '' }; return }
    S.overlay = { type: 'dlg', id, q: 'q5', r: 'r6', c: id === 'unpair' ? D.devices[0].name : 'mock', ck: id === 'restore' ? 2 : 2 }
  })
  const total = GROUPS.reduce((n, g) => n + g[1].length, 0)
  return <div className="fd"><div className="fd-in">
    <header className="stack" style={{ gap: 6 }}><h1>Dialogs</h1><p className="lead">{total} dialogs from the #569 audit, all on the U1 contract: a size from sm to xl, focus on the first field or the safe action, and the footer as extra · Cancel · primary. Click one to open it.</p></header>
    <div className="dlg-contract"><div><b>Sizes</b><span>sm 420 · md 560 · lg 760 · xl 1040</span></div><div><b>Focus</b><span>First field, else the safe action (Cancel, Keep, Deny)</span></div><div><b>Footer</b><span>Extra at the start · Cancel · Primary or danger at the end</span></div><div><b>Close</b><span>Esc, the ✕ or the scrim; focus goes back to the trigger</span></div></div>
    {GROUPS.map(([g, items]) => <section key={g}><h2>{g}</h2><div className="dgrid">{items.map(([id, name, size, ref]) => <button key={id} className="dcard" onClick={open(id)}><span className="dmini"><i className={'s-' + size} /></span><b>{name}</b><span className="muted">{size} · {ref}</span></button>)}</div></section>)}</div></div>
}
export { plural }
