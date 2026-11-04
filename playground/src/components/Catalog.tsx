/* The rest of the #569 dialog inventory on the U1 contract, and a gallery that opens each one. */
import { D } from '../mock/data'
import { S, emit, run, toast, plural } from '../state/store'
import { Icon, Av, Kbd } from './ui'
import type { DialogSpec } from './Overlays'
import { KEYS } from './Settings'

const p = (s: string) => <p style={{ color: 'var(--text-secondary)' }}>{s}</p>
function QR () { // a stand-in pairing code, drawn from a fixed pattern
  const cells: boolean[] = []; let x = 7
  for (let i = 0; i < 625; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; cells.push((x >> 16) % 3 === 0) }
  const finder = (r: number, c: number) => [[0, 0], [0, 18], [18, 0]].some(([a, b]) => r >= a && r < a + 7 && c >= b && c < b + 7)
  return <svg viewBox="0 0 25 25" width="168" height="168" role="img" aria-label="Pairing code" style={{ background: '#fff', padding: 8, borderRadius: 8 }} shapeRendering="crispEdges">
    {cells.map((on, i) => { const r = Math.floor(i / 25), c = i % 25; if (finder(r, c)) { const a = r < 7 ? 0 : 18, b = c < 7 ? 0 : 18, rr = r - a, cc = c - b; const f = rr === 0 || rr === 6 || cc === 0 || cc === 6 || (rr > 1 && rr < 5 && cc > 1 && cc < 5); return f ? <rect key={i} x={c} y={r} width="1" height="1" fill="#0d100e" /> : null } return on ? <rect key={i} x={c} y={r} width="1" height="1" fill="#0d100e" /> : null })}</svg>
}

export const MORE_DIALOGS: Record<string, () => DialogSpec> = {
  accounts: () => ({ size: 'md', icon: 'key', title: 'Agent accounts', body: () => <>
    {Object.values(D.providers).map(pv => <div key={pv.id} className="ssec"><div className="srow"><div className="l"><b><Av p={pv.id} size="s16" />{pv.name}</b><p>{pv.account} · {pv.plan} plan</p></div><div className="ra"><span className="res ok">Connected</span><button className="btn sm ghost" onClick={run(() => toast(`Signed out of ${pv.name}`, { undo: () => {} }))}>Sign out</button></div></div></div>)}
    <div className="callout info"><Icon n="info" /><span>Each CLI keeps its own sign-in. OXESpace never sees your password.</span></div></> }),
  newagent: () => ({ size: 'md', icon: 'sparkle', title: 'New custom agent', body: () => <>
    <div className="field"><label htmlFor="na-name">Name</label><input className="input" id="na-name" placeholder="Migration reviewer" /></div>
    <div className="field"><label htmlFor="na-ins">Instructions</label><textarea className="input" id="na-ins" rows={4} placeholder="Review Postgres migrations for locks, missing indexes and irreversible steps." /></div>
    <div className="row"><div className="field" style={{ flex: 1 }}><label htmlFor="na-model">Model</label><select className="sel" id="na-model"><option>Sonnet 5.5</option><option>Opus 5.5</option><option>Haiku 5.5</option></select></div><div className="field" style={{ flex: 1 }}><label htmlFor="na-acc">Access</label><select className="sel" id="na-acc"><option>Read only</option><option>Can edit</option></select></div></div></>,
    primary: { label: 'Create agent', act: () => toast('Created the agent') } }),
  newauto: () => ({ size: 'md', icon: 'clock', title: 'New automation', body: () => <>
    <div className="field"><label htmlFor="au-what">What should run?</label><textarea className="input" id="au-what" rows={3} placeholder="Check outdated dependencies in cajui-api and open a task if any are security fixes" /></div>
    <div className="row"><div className="field" style={{ flex: 1 }}><label htmlFor="au-when">When</label><select className="sel" id="au-when"><option>Every day at 02:00</option><option>Mondays at 08:00</option><option>Every hour</option></select></div><div className="field" style={{ flex: 1 }}><label htmlFor="au-agent">Agent</label><select className="sel" id="au-agent"><option>Codex · read only</option><option>Claude Code · read only</option></select></div></div>
    <div className="callout info"><Icon n="info" /><span>Automations run read only. Anything else opens a task and waits for you.</span></div></>, primary: { label: 'Create automation', act: () => toast('Created the automation') } }),
  skills: () => ({ size: 'lg', icon: 'book', title: 'Skills', body: () => <>
    <label className="search mside-search" style={{ margin: 0 }}><Icon n="search" s={12} /><input placeholder="Find a skill" aria-label="Find a skill" /></label>
    <div className="cards2">{[['pix-rules', 'Banco Central Pix rules for txid, expiry and refunds'], ['migrations', 'How we write and review Postgres migrations'], ['release-notes', 'Release notes in our voice'], ['pdf', 'Read and fill PDF forms'], ['xlsx', 'Read and write spreadsheets'], ['openapi', 'Keep OpenAPI specs in sync with handlers']].map(([n, d]) => <div key={n} className="mcard"><b style={{ color: 'var(--text-primary)' }}>{n}</b><span>{d}</span><span className="row">{S.set.skillOn[n] != null ? <span className="res ok">Installed</span> : <button className="btn sm" onClick={run(() => { S.set.skillOn[n] = true; toast(`Installed ${n}`, { undo: () => { delete S.set.skillOn[n]; emit() } }) })}>Install</button>}</span></div>)}</div></> }),
  pair: () => ({ size: 'md', icon: 'phone', title: 'Pair a phone', body: () => <div className="row" style={{ alignItems: 'start', gap: 20 }}><QR />
    <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, color: 'var(--text-secondary)' }}><li>Open OXESpace on your Android phone.</li><li>Tap <b>Pair with a computer</b>.</li><li>Point the camera at this code.</li><li>Check that the phone shows <span className="mono" style={{ color: 'var(--text-primary)' }}>4 1 9 · 7 7 2</span>.</li></ol></div>, cancel: 'Done' }),
  unpair: () => { const n = S.overlay!.c!; return { size: 'sm', icon: 'phone', title: `Unpair ${n}?`, safeFirst: true, body: () => p('The phone loses access at once and its key is revoked. To use it again you pair it from scratch.'), primary: { label: 'Unpair', danger: true, act: () => { (S.unpaired ||= []).push(n); toast(`Unpaired ${n}`) } } } },
  clearhistory: () => ({ size: 'sm', icon: 'trash', title: 'Clear history?', safeFirst: true, body: () => p('Deletes 14 archived tasks, their conversations and checkpoints (2.1 GB). Open and pinned tasks stay. This can\'t be undone.'), primary: { label: 'Clear history', danger: true, act: () => toast('History cleared') } }),
  about: () => ({ size: 'sm', icon: 'info', title: 'About OXESpace', body: () => <><div className="row"><span className="logo" style={{ width: 32, height: 32 }} /><div><b style={{ font: '700 16px var(--f-display)' }}>OXESpace 1.5.0</b><p className="muted" style={{ fontSize: 12 }}>Electron 39 · Node 22.11 · Windows 11 · build 2026.11.03</p></div></div><p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Made in Recife. Mandacaru design system. 174 open-source packages; their licenses are in THIRD_PARTY_NOTICES.</p></>,
    extra: <button className="btn ghost" onClick={run(() => toast('Copied the version details'))}><Icon n="copy" s={12} />Copy details</button> }),
  shortcuts: () => ({ size: 'md', icon: 'keyboard', title: 'Keyboard shortcuts', body: () => <div className="keys" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', fontSize: 13 }}>{KEYS.map(([a, k]) => <span key={a} style={{ display: 'contents' }}><span>{a}</span><Kbd>{k}</Kbd></span>)}</div> }),
  usage: () => ({ size: 'md', icon: 'activity', title: 'Usage', body: () => <>{Object.values(D.providers).map(pv => <div key={pv.id} className="ssec"><div className="srow wide"><div className="l"><b><Av p={pv.id} size="s16" />{pv.name} · {pv.plan}</b><p>{pv.id === 'claude' ? 'Claude account · 5 h window resets at 17:20' : 'ChatGPT account · weekly limit resets Monday'}</p></div>
    <div className="meter"><i style={{ width: pv.id === 'claude' ? '41%' : '18%' }} /></div><p className="muted" style={{ fontSize: 12 }}>{pv.id === 'claude' ? '41% used · $3.89 today across 5 tasks' : '18% used · about $0.84 today (estimated from tokens)'}</p></div></div>)}</> }),
  team: () => ({ size: 'md', icon: 'users', title: 'Project team', body: () => <div className="lst" style={{ padding: 0 }}>{[['Marina Sá', 'You · owner', 'online'], ['Rafael Moura', 'Reviewer', 'online'], ['Júlia Prado', 'Developer', 'away']].map(([n, r, s]) => <div key={n} className="li"><span>{n}</span><span className={'sdot ' + (s === 'online' ? 'on' : 'off')} /><span className="sub">{r}</span></div>)}</div>,
    extra: <button className="btn ghost" onClick={run(() => toast('Copied an invite link (valid 24 h)'))}><Icon n="plus" s={12} />Invite</button> }),
  unsaved: () => ({ size: 'sm', icon: 'warn', title: 'Close with unsaved work?', safeFirst: true, body: () => p('open-invoices.sql in OxeQuery and one OxePost request have changes that aren\'t saved.'), cancel: 'Keep working', primary: { label: 'Close without saving', danger: true, act: () => toast('Closed (simulated)') } }),
  termrestore: () => ({ size: 'md', icon: 'term', title: 'Restore your terminals?', body: () => <>{p('OXESpace closed with 4 terminals open. Restore them where they were?')}
    <div className="lst" style={{ padding: 0 }}>{['api · npm run dev', 'tests · npm test -- charges (agent)', 'report · cajui-api/t143', 'claude · cajui-web'].map(t => <label key={t} className="row" style={{ fontSize: 13, padding: '4px 0' }}><input type="checkbox" defaultChecked />{t}</label>)}</div></>, cancel: 'Start fresh', primary: { label: 'Restore 4 terminals', act: () => toast('Restored 4 terminals') } }),
  command: () => ({ size: 'md', icon: 'slash', title: 'Run /review', body: () => <><div className="field"><label htmlFor="cm-scope">What to review</label><select className="sel" id="cm-scope"><option>Changes in this task (4 files)</option><option>Only staged changes</option></select></div><div className="field"><label htmlFor="cm-focus">Focus (optional)</label><input className="input" id="cm-focus" placeholder="Race conditions, missing tests" /></div></>, primary: { label: 'Run', act: () => toast('/review sent to the agent') } })
}

const GROUPS: [string, [string, string, string, string][]][] = [
  ['Tasks and conversation', [['newtask', 'New task', 'md', 'U5a'], ['rename', 'Rename task', 'sm', 'U5a'], ['deletetask', 'Delete task', 'sm', 'T58 §7b'], ['restore', 'Restore files to a checkpoint', 'md', 'C'], ['branch', 'Branch from a checkpoint', 'md', 'C'], ['fullaccess', 'Give full access', 'sm', 'T58 §4.3'], ['scdiscard', 'Discard the side chat', 'sm', 'T60'], ['delegate', 'Delegate to a teammate', 'md', 'U5c'], ['command', 'Run a slash command', 'md', 'U5a'], ['background', 'Background activity', 'md', 'G-05'], ['archived', 'Archived tasks', 'md', 'U5a']]],
  ['Approvals', [['approve:ap_sql', 'Impact preview: database write', 'lg', 'T67'], ['approve:ap_down', 'Impact preview: delete a volume', 'lg', 'T67'], ['approve:ap_push', 'Impact preview: git push', 'lg', 'T67']]],
  ['Changes', [['discard', 'Discard all changes', 'sm', 'U5a'], ['finish', 'Finish the worktree', 'md', 'U5a']]],
  ['OxeQuery', [['newconn', 'New connection', 'md', 'Q-02, A5'], ['oqsettings', 'OxeQuery settings', 'md', 'Q-03'], ['qrow', 'What an agent ran', 'lg', 'T63']]],
  ['OxePost', [['import', 'Import requests', 'md', 'H-02'], ['envs', 'Environments', 'lg', 'H-03'], ['prow', 'What an agent sent', 'lg', 'T64']]],
  ['OxePod', [['podremove', 'Remove a container', 'sm', 'P-01'], ['poddown', 'Stop a stack', 'sm', 'P-01']]],
  ['App', [['mcp', 'MCP servers', 'lg', 'G-03'], ['skills', 'Skills', 'lg', 'G-03, G-04'], ['accounts', 'Agent accounts', 'md', 'G-07'], ['usage', 'Usage', 'md', 'G-06'], ['newagent', 'New custom agent', 'md', 'X10'], ['newauto', 'New automation', 'md', 'S-05'], ['pair', 'Pair a phone', 'md', 'U5c'], ['unpair', 'Unpair a phone', 'sm', 'U2'], ['clearhistory', 'Clear history', 'sm', 'U2'], ['team', 'Project team', 'md', 'G-02'], ['report', 'Report a problem', 'md', 'G-09'], ['about', 'About', 'sm', 'U5c'], ['shortcuts', 'Keyboard shortcuts', 'md', 'U5c'], ['unsaved', 'Unsaved work', 'sm', 'U5c'], ['termrestore', 'Restore terminals', 'md', 'U5c'], ['addproject', 'Add a project', 'md', 'D-06'], ['newws', 'New workspace', 'md', 'D-06'], ['removews', 'Remove workspace', 'sm', 'G-08']]]
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
