/* Settings on U2: every page uses the same row; changes apply at once. A change that widens what an agent can do,
   or that loses data, shows an undo toast. A delete that can't be undone keeps its confirmation dialog. */
import type { ReactNode } from 'react'
import { D } from '../mock/data'
import { S, emit, run, toast, plural, task, prov } from '../state/store'
import { Icon, Av, Kbd, StateBlock } from './ui'
import { syncScreen } from '../screens/registry'
import { CALLS } from './Cockpit'

type Set = typeof S.set
type K = keyof Set
/** Apply at once. Risky changes (plan-1.5-ui.md, U2 list) get an undo toast. */
function setVal<k extends K> (key: k, v: Set[k], risky?: string) {
  const before = S.set[key]
  S.set[key] = v
  if (key === 'theme') S.mode = v === 'dark' ? 'dark' : v === 'light' ? 'light' : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  if (risky) toast(risky, { undo: () => { S.set[key] = before; emit() } })
  emit()
}
export function Switch ({ on, onChange, label, risky, disabled }: { on: boolean; onChange: () => void; label: string; risky?: boolean; disabled?: boolean }) {
  return <button className={'tg-sw' + (risky ? ' risk' : '')} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange} />
}
function Row ({ label, desc, children, wide, tag }: { label: ReactNode; desc?: ReactNode; children?: ReactNode; wide?: boolean; tag?: ReactNode }) {
  return <div className={'srow' + (wide ? ' wide' : '')}><div className="l"><b>{label}{tag}</b>{desc ? <p>{desc}</p> : null}</div>{children ? <div className="ra">{children}</div> : null}</div>
}
function Section ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="ssec"><div className="ssec-h"><h2>{title}</h2>{action}</div>{children}</section>
}
function Seg<T extends string> ({ value, opts, onChange, label }: { value: T; opts: [T, string][]; onChange: (v: T) => void; label: string }) {
  return <div className="segc" role="radiogroup" aria-label={label}>{opts.map(([v, l]) => <button key={v} role="radio" aria-checked={value === v} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>
}
function Sel ({ value, opts, onChange, label }: { value: string; opts: [string, string][]; onChange: (v: string) => void; label: string }) {
  return <select className="sel" aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
}
const sw = (key: K, label: string, risky?: [string, string]) => { const on = !!S.set[key]; return <Switch on={on} label={label} risky={!!risky && !on} onChange={() => setVal(key, !on as never, risky ? (on ? risky[1] : risky[0]) : undefined)} /> }
const dlg = (id: string, extra?: Record<string, string>) => run(() => { S.overlay = Object.assign({ type: 'dlg', id }, extra || {}) })
const Badge = ({ t }: { t: string }) => <span className="pill neutral" style={{ height: 18 }}>{t}</span>

/* ------------------------------------------------------------------ pages */
const PAGES: { id: string; group: 'app' | 'ws'; icon: string; name: string; desc: string; body: () => ReactNode; badge?: () => string | null }[] = [
  { id: 'general', group: 'app', icon: 'gear', name: 'General', desc: 'Language, what opens at start, and updates.', body: () => <>
    <Section title="Basics">
      <Row label="Language" desc="The app restarts its window to switch."><Sel label="Language" value={S.set.lang} onChange={v => setVal('lang', v)} opts={[['en', 'English'], ['pt', 'Português (Brasil)']]} /></Row>
      <Row label="When OXESpace opens" desc="Where you start each day."><Sel label="When OXESpace opens" value={S.set.startup} onChange={v => setVal('startup', v)} opts={[['last', 'Where I left off'], ['tasks', 'The task list'], ['queue', 'Approvals']]} /></Row>
      <Row label="External editor" desc="Where Open in editor sends files."><Sel label="External editor" value={S.set.editor || 'code'} onChange={v => setVal('editor' as K, v as never)} opts={[['code', 'VS Code'], ['cursor', 'Cursor'], ['idea', 'IntelliJ IDEA'], ['zed', 'Zed']]} /></Row>
      <Row label="New tasks get their own worktree" desc="Each task works on its own branch in ~/.oxespace/worktrees, so your checkout stays clean.">{sw('worktreeDefault', 'New tasks get their own worktree')}</Row></Section>
    <Section title="Updates"><Row label="OXESpace 1.5.0" desc="Stable channel · checked today at 09:12. You're up to date."><button className="btn sm" onClick={run(() => toast('You\'re on the latest version'))}>Check now</button></Row>
      <Row label="Update channel"><Seg label="Update channel" value={'stable'} opts={[['stable', 'Stable'], ['beta', 'Beta']]} onChange={() => toast('Beta builds arrive about a week early')} /></Row></Section></> },
  { id: 'appearance', group: 'app', icon: 'palette', name: 'Appearance', desc: 'Theme, text size and density. Changes show at once.', body: () => <>
    <Section title="Theme"><div className="srow wide"><div className="cards2">{([['system', 'Match the system'], ['light', 'Light'], ['dark', 'Dark']] as const).map(([v, l]) => <button key={v} className="mcard" aria-pressed={S.set.theme === v} onClick={() => setVal('theme', v)}>
      <span className="pv" style={{ background: v === 'dark' ? '#131714' : v === 'light' ? '#fbfdfc' : 'linear-gradient(90deg,#fbfdfc 50%,#131714 50%)' }}><i style={{ background: v === 'dark' ? '#1b201c' : '#edf1ee' }} /><i /></span><b style={{ fontWeight: 600 }}>{l}</b></button>)}</div></div></Section>
    <Section title="Reading">
      <Row label="Text size" desc={`Conversation and settings text: ${S.set.textSize} px.`}><input type="range" className="rng" min={12} max={18} value={S.set.textSize} aria-label="Text size" onChange={e => setVal('textSize', +e.target.value)} /></Row>
      <Row label="Density"><Seg label="Density" value={S.set.density} opts={[['comfortable', 'Comfortable'], ['compact', 'Compact']]} onChange={v => setVal('density', v)} /></Row>
      <Row label="Reduce motion" desc="Follows the system setting. Pulses stand still and panels appear without sliding.">{<Switch on={false} label="Reduce motion" onChange={() => toast('Reduce motion follows Windows › Accessibility › Visual effects')} />}</Row></Section></> },
  { id: 'agents', group: 'app', icon: 'sparkle', name: 'Agents', desc: 'Accounts, default models and custom agents.', body: () => <>
    {Object.values(D.providers).map(p => <Section key={p.id} title={p.name} action={<span className="res ok">Signed in</span>}>
      <Row label={<><Av p={p.id} size="s16" />{p.account}</>} desc={`${p.plan} plan · ${p.id === 'claude' ? '41% of the 5 h window used' : 'usage resets at 21:00'}`}><button className="btn sm" onClick={dlg('accounts', { r: p.id })}>Manage…</button></Row>
      <Row label="Default model" desc="New tasks start with it; each task can change it."><Sel label={`${p.name} default model`} value={p.id === 'claude' ? S.set.claudeModel : S.set.codexModel} onChange={v => setVal(p.id === 'claude' ? 'claudeModel' : 'codexModel', v)} opts={p.models.map(m => [m, m])} /></Row>
      {p.id === 'claude' ? <Row label="Default effort"><Seg label="Default effort" value={S.set.claudeEffort} opts={p.efforts.map(e => [e, e] as [string, string])} onChange={v => setVal('claudeEffort', v)} /></Row> : null}</Section>)}
    <Section title="Agent for new tasks"><Row label="Start new tasks with"><Seg label="Agent for new tasks" value={S.set.defaultAgent} opts={[['claude', 'Claude Code'], ['codex', 'Codex']]} onChange={v => setVal('defaultAgent', v)} /></Row></Section>
    <Section title="Custom agents" action={<button className="btn sm" onClick={dlg('newagent')}><Icon n="plus" s={12} />New agent</button>}>
      <Row label="Migration reviewer" desc="Sonnet 5.5 · read only · uses the migrations skill"><button className="btn sm ghost" onClick={dlg('newagent')}>Edit</button></Row>
      <Row label="Release notes writer" desc="Haiku 5.5 · read only · uses release-notes"><button className="btn sm ghost" onClick={dlg('newagent')}>Edit</button></Row></Section></> },
  { id: 'approvals', group: 'app', icon: 'shield', name: 'Approvals and safety', desc: 'What agents may do without asking. Anything that widens it applies at once, with an undo.', badge: () => null, body: () => <>
    <Section title="Asking first">
      <Row label="Approve reads without asking" desc="Reading files, listing and searching. Writes, network calls and database changes always ask.">{sw('autoApproveReads', 'Approve reads without asking', ['Reads no longer ask', 'Reads ask again'])}</Row>
      <Row label="Network access" desc="Hosts agents can call."><Sel label="Network access" value={S.set.network} onChange={v => setVal('network', v, v === 'any' ? 'Agents can call any host' : undefined)} opts={[['none', 'None'], ['ask', 'Ask for each new host'], ['allow', 'Allowed hosts only'], ['any', 'Any host']]} /></Row>
      <Row label="Access for new tasks"><Seg label="Access for new tasks" value={S.set.defaultAccess} opts={[['read', 'Read only'], ['edit', 'Can edit'], ['full', 'Full access']]} onChange={v => setVal('defaultAccess', v, v === 'full' ? 'New tasks start with full access' : undefined)} /></Row>
      <Row label="Skip approvals when resuming a session" desc={<>Resumed sessions keep running without asking. <span className="dz-t">Only for throwaway environments.</span></>}>{sw('bypassResume', 'Skip approvals when resuming', ['Resumed sessions no longer ask', 'Resumed sessions ask again'])}</Row></Section>
    <div className="callout info"><Icon n="info" /><span>An irreversible approval always needs a 1.2 s hold, and Deny is always the default. These can't be turned off.</span></div></> },
  { id: 'notifications', group: 'app', icon: 'bell', name: 'Notifications', desc: 'When OXESpace and your phone get your attention.', body: () => <>
    <Section title="On this computer" action={<button className="btn sm" onClick={run(() => toast('Sent a test notification'))}>Send a test</button>}>
      <Row label="An agent needs you" desc="Approvals and questions. Recommended.">{sw('notifyApprovals', 'An agent needs you')}</Row>
      <Row label="A task finishes or stops">{sw('notifyDone', 'A task finishes or stops')}</Row>
      <Row label="Play a sound">{sw('notifySound', 'Play a sound')}</Row></Section>
    <Section title="On your phone"><Row label="Paired phones" desc="Paired phones get Needs you, Finished and Failed notifications while they're on the same Wi-Fi. Every answer on the phone asks for your fingerprint or screen lock. Database writes, MCP confirmations, permissions and secret questions are answered only here."><button className="btn sm" onClick={run(() => { S.page = 'devices'; syncScreen() })}>Devices</button></Row></Section></> },
  { id: 'keyboard', group: 'app', icon: 'keyboard', name: 'Keyboard', desc: 'Every shortcut. Actions show when you point at a row.', body: () => <section className="ssec"><div className="ssec-h"><h2>Shortcuts</h2><label className="search mside-search" style={{ margin: 0, width: 200 }}><Icon n="search" s={12} /><input placeholder="Filter shortcuts" aria-label="Filter shortcuts" value={S.kFilter || ''} onChange={e => { S.kFilter = e.target.value; emit() }} /></label></div>
    {KEYS.filter(([a]) => !S.kFilter || a.toLowerCase().includes(S.kFilter.toLowerCase())).map(([a, k]) => { const cur = S.keys?.[a] ?? k; const changed = cur !== k
      return <div key={a} className="kbdrow"><span>{a}</span><span><Kbd>{cur}</Kbd>{changed ? <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>changed</span> : null}</span><span className="acts"><button className="btn sm ghost" onClick={run(() => { (S.keys ||= {})[a] = a === 'New task' ? 'Ctrl Shift N' : cur + '…'; toast(`Press the new keys for "${a}"`) })}>Change</button>{changed ? <button className="btn sm ghost" onClick={run(() => { delete S.keys![a] })}>Reset</button> : null}</span></div> })}</section> },
  { id: 'terminal', group: 'app', icon: 'term', name: 'Terminal', desc: 'How terminals look and which shells and commands agents may start.', body: () => <>
    <Section title="Look"><Row label="Font size" desc={`${S.set.termFont} px, IBM Plex Mono`}><input type="range" className="rng" min={10} max={18} value={S.set.termFont} aria-label="Terminal font size" onChange={e => setVal('termFont', +e.target.value)} /></Row>
      <Row label="Cursor"><Seg label="Cursor" value={S.set.termCursor} opts={[['bar', 'Bar'], ['block', 'Block'], ['underline', 'Underline']]} onChange={v => setVal('termCursor', v)} /></Row>
      <Row label="Lines kept" desc="Scrollback per terminal."><Sel label="Lines kept" value={String(S.set.scrollback)} onChange={v => setVal('scrollback', +v)} opts={[['5000', '5,000'], ['10000', '10,000'], ['50000', '50,000']]} /></Row></Section>
    <Section title="Shells and agent commands" action={<button className="btn sm" onClick={run(() => toast('Added a profile', { undo: () => {} }))}><Icon n="plus" s={12} />Add profile</button>}>
      <Row label="Default shell"><Sel label="Default shell" value={S.set.shell} onChange={v => setVal('shell', v, 'Default shell changed')} opts={[['bash', 'Git Bash'], ['pwsh', 'PowerShell 7'], ['wsl', 'WSL · Ubuntu']]} /></Row>
      <Row label="claude" desc={<span className="mono">claude --model opus</span>}><button className="btn sm ghost" onClick={run(() => toast('Edited the claude profile', { undo: () => {} }))}>Edit</button></Row>
      <Row label="codex" desc={<span className="mono">codex --sandbox workspace-write</span>}><button className="btn sm ghost" onClick={run(() => toast('Edited the codex profile', { undo: () => {} }))}>Edit</button></Row></Section></> },
  { id: 'tools', group: 'app', icon: 'plug', name: 'MCP servers and skills', desc: 'Tools agents can use. Changes apply at once, with an undo.', badge: () => '1', body: () => <>
    <Section title="MCP servers" action={<button className="btn sm" onClick={dlg('mcp')}><Icon n="plus" s={12} />Add server</button>}>{D.mcp.map(m => { const on = m.builtin || S.set.mcpOn[m.name]
      return <Row key={m.name} label={<><span className={'sdot ' + (m.status === 'err' ? 'bad' : on ? 'on' : 'off')} />{m.name}{m.builtin ? <Badge t="built in" /> : null}</>} desc={m.status === 'err' ? <span className="dz-t">{m.err}. Sign in again to use it.</span> : `${m.desc} · ${plural(m.tools, 'tool')}`}>
        {m.status === 'err' ? <button className="btn sm" onClick={run(() => toast('Opened the Sentry sign-in in your browser'))}>Sign in</button> : null}<Switch on={!!on} risky={!on} disabled={m.builtin} label={`Turn ${m.name} ${on ? 'off' : 'on'}`} onChange={() => { S.set.mcpOn[m.name] = !on; toast(`${m.name} turned ${on ? 'off' : 'on'}`, { undo: () => { S.set.mcpOn[m.name] = !!on; emit() } }); emit() }} /></Row> })}</Section>
    <Section title="Sites the browser has seen"><Row label="localhost:3002" desc="Opened by Add CSV export to the statements page · today"><button className="btn sm ghost" onClick={run(() => toast('Removed localhost:3002', { undo: () => {} }))}>Remove</button></Row><Row label="sandbox.pix-psp.com.br" desc="Opened by Test Pix webhooks against the sandbox · today"><button className="btn sm ghost" onClick={run(() => toast('Removed sandbox.pix-psp.com.br', { undo: () => {} }))}>Remove</button></Row></Section>
    <Section title="Skills">{D.skills.map(k => <Row key={k.name} label={<span className="mono">/{k.name}</span>} desc={k.desc}><span className="muted" style={{ fontSize: 12 }}>{k.scope === 'project' ? 'This workspace' : 'All workspaces'}</span></Row>)}</Section></> },
  { id: 'devices', group: 'app', icon: 'phone', name: 'Phone and devices', desc: 'Follow conversations and answer requests from the OXESpace Android app.', body: () => { const on = !!S.set.phoneOn; const devs = D.devices.filter(d => !(S.unpaired || []).includes(d.name))
    return <>
    <Section title="Phone connection"><Row label="Let phones connect" desc={on ? 'On. Listening on 192.168.0.14:47821, on this network only. Windows may ask to allow it through the firewall once.' : 'Off. No port is open.'}><Switch on={on} risky={!on} label="Let phones connect" onChange={() => setVal('phoneOn' as K, !on as never, on ? undefined : 'Phones on this Wi-Fi can now connect')} /></Row>
      <Row label="Name of this computer" desc={`Phones show "${S.pcName}".`}><input className="input" style={{ width: 180 }} value={S.pcDraft ?? S.pcName} aria-label="Name of this computer" onChange={e => { S.pcDraft = e.target.value; emit() }} /><button className="btn sm" disabled={!S.pcDraft || S.pcDraft.trim() === S.pcName} onClick={run(() => { S.pcName = S.pcDraft!.trim(); S.pcDraft = undefined; toast(`Phones now show "${S.pcName}"`) })}>Save</button><button className="btn sm ghost" disabled={S.pcName === 'MARINA-DESKTOP' && !S.pcDraft} onClick={run(() => { S.pcName = 'MARINA-DESKTOP'; S.pcDraft = undefined; toast('Using the default name, MARINA-DESKTOP') })}>Use default</button></Row></Section>
    <Section title={`Paired phones · ${devs.length} of 5`} action={<button className="btn sm" disabled={!on} title={on ? undefined : 'Turn on the phone connection first'} onClick={dlg('pair')}><Icon n="plus" s={12} />Pair a phone</button>}>
      {devs.length ? devs.map((d, i) => S.renaming === d.name ? <div key={d.name} className="srow"><input className="input" autoFocus aria-label={`New name for ${d.name}`} defaultValue={S.devNames[d.name] || d.name} onKeyDown={e => { if (e.key === 'Enter') { S.devNames[d.name] = (e.target as HTMLInputElement).value.trim() || d.name; S.renaming = null; toast('Renamed the phone'); emit() } if (e.key === 'Escape') { S.renaming = null; emit() } }} /><div className="ra"><button className="btn sm" onClick={run(() => { S.renaming = null })}>Cancel</button></div></div> : <Row key={d.name} label={<><span className={'sdot ' + (on && i === 0 ? 'on' : 'off')} />{S.devNames[d.name] || d.name}</>} desc={`${d.os} · paired ${d.paired} · ${on && i === 0 ? 'connected now' : 'last seen ' + d.last.replace('Active now', 'today 14:41')}`}><button className="btn sm ghost" onClick={run(() => { S.renaming = d.name })}>Rename</button><button className="btn sm ghost dtext" onClick={dlg('unpair', { c: d.name })}>Unpair…</button></Row>) : <div className="srow"><p className="muted" style={{ fontSize: 13 }}>No phones paired.</p></div>}</Section>
    <Section title="Typing in terminals" action={<button className="btn sm" onClick={run(() => { S.phoneTyping = []; toast('Phones can no longer type in any terminal') })}>Stop typing from the phone everywhere</button>}>
      <div className="srow wide"><p className="muted" style={{ fontSize: 12 }}>Off for every terminal by default. Turn it on per terminal from the pane's ⋯ menu › Allow typing from the phone. It turns off again when OXESpace restarts.</p></div>
      {(S.phoneTyping || []).length ? (S.phoneTyping || []).map(n => <Row key={n} label={<><Icon n="term" s={12} />{n}</>} desc="A paired phone can type here" />) : null}</Section>
    <Section title="What a phone can do"><div className="srow wide"><div className="cando"><div><b>From the phone</b><ul><li>Follow conversations and terminals</li><li>Send messages to an agent</li><li>Allow or deny commands and file edits, after your fingerprint or screen lock</li><li>Stop an agent</li></ul></div><div><b>Only at this computer</b><ul><li>Database writes and anything in OxeQuery</li><li>MCP confirmations, permissions and secret questions</li><li>Requests cut short (the phone can only deny them)</li><li>Settings, policy and pairing</li></ul></div></div></div></Section>
    <div className="callout info"><Icon n="lock" /><span>The phone talks only to this computer, over your local network, never through the internet. The phone and this computer must be on the same Wi-Fi.</span></div></> } },
  { id: 'data', group: 'app', icon: 'archive', name: 'Data and privacy', desc: 'What OXESpace keeps on this computer, and for how long.', body: () => <>
    <Section title="History"><Row label="Keep conversations and checkpoints" desc="Older ones are deleted, except pinned tasks."><Sel label="Keep history for" value={S.set.retention} onChange={v => setVal('retention', v, Number(v) < Number(S.set.retention) ? `History older than ${v} days will be deleted tonight` : undefined)} opts={[['30', '30 days'], ['90', '90 days'], ['365', '1 year'], ['0', 'Forever']]} /></Row>
      <Row label="Clear history" desc="Deletes every archived task, its conversation and its checkpoints (2.1 GB)."><button className="btn sm dtext" onClick={dlg('clearhistory')}>Clear history…</button></Row></Section>
    <Section title="Exports"><Row label="Removed in 1.5.0" desc="OxePost collections, memory notes and automations, with their history · 08/11 14:02. Files in .oxespace/requests stay."><button className="btn sm" onClick={run(() => toast('Opened the exports folder'))}>Show file</button></Row></Section>
    <Section title="Sharing"><Row label="Send crash reports" desc="Stack traces and versions, never file contents or prompts.">{sw('crashReports', 'Send crash reports')}</Row>
      <Row label="Count feature use on this computer" desc="Nothing is sent. Off by default.">{sw('sendTelemetry', 'Count feature use on this computer')}</Row></Section></> },
  { id: 'permissions', group: 'app', icon: 'key', name: 'What agents can do', desc: 'Everything agents may do without asking. Revoke anything here.', body: () => <PermissionsPage /> },
  { id: 'activity', group: 'app', icon: 'activity', name: 'Agent activity', desc: 'Everything agents did outside the conversation, in one list.', badge: () => S.resolved.ap_sql ? null : '1', body: () => <ActivityPage /> },
  { id: 'diagnostics', group: 'app', icon: 'cpu', name: 'Diagnostics', desc: 'Checks to run when something doesn\'t work.', body: () => <>
    <Section title="Health" action={<button className="btn sm" onClick={run(() => toast('Checked again: 6 passed, 1 warning'))}><Icon n="refresh" s={12} />Check again</button>}>{([['Claude Code CLI', 'ok', '2.4.1 on PATH'], ['Codex CLI', 'ok', '0.61.0 on PATH'], ['Docker', 'ok', 'Docker Desktop 4.36'], ['Git', 'ok', '2.47.1'], ['Android tools', 'ok', 'adb 36.0.0 · 1 device'], ['Local database', 'ok', '84 MB · last backup 03:00'], ['sentry MCP server', 'warn', 'Needs sign-in again']] as const).map(([n, s, d]) => <Row key={n} label={<><span className={'sdot ' + (s === 'ok' ? 'on' : 'wait')} />{n}</>} desc={d} />)}</Section>
    <Section title="Logs"><Row label="Main process log" desc="~/.oxespace/logs/main.log · 2.4 MB"><button className="btn sm" onClick={run(() => toast('Opened the logs folder'))}>Open folder</button></Row><Row label="Report a problem" desc="Includes versions and the last 200 log lines, never file contents."><button className="btn sm" onClick={dlg('report')}>Report…</button></Row></Section></> },
  { id: 'about', group: 'app', icon: 'info', name: 'About', desc: 'Version and licenses.', body: () => <Section title="OXESpace"><Row label="Version 1.5.0" desc="Electron 39 · Node 22.11 · Windows 11" /><Row label="Third-party licenses" desc="174 packages"><button className="btn sm" onClick={dlg('about')}>View</button></Row><Row label="Shortcuts"><button className="btn sm" onClick={dlg('shortcuts')}>Show all</button></Row></Section> },
  { id: 'ws-projects', group: 'ws', icon: 'folder', name: 'Projects', desc: `The folders in ${D.company.name}.`, body: () => <Section title="Projects" action={<button className="btn sm" onClick={dlg('addproject')}><Icon n="plus" s={12} />Add project</button>}>{Object.values(D.projects).filter(p => !S.removedProj?.includes(p.id)).map(p => <Row key={p.id} label={p.name} desc={<><span className="mono">{p.path}</span> · {p.stack}</>}><button className="btn sm ghost" onClick={run(() => { (S.removedProj ||= []).push(p.id); toast(`Removed ${p.name} from the workspace. The folder stays on disk.`, { undo: () => { S.removedProj = S.removedProj!.filter(x => x !== p.id); emit() } }) })}>Remove</button></Row>)}</Section> },
  { id: 'ws-policy', group: 'ws', icon: 'shield', name: 'Policy', desc: 'Rules every agent in this workspace follows, from a file in the repository.', body: () => <>
    <Section title="Policy file"><Row label={<span className="mono">cajui-api/.oxespace/policy.yaml</span>} desc="Loaded at 14:02 · 4 rules"><button className="btn sm" onClick={run(() => toast('Opened policy.yaml in your editor'))}>Open in editor</button><button className="btn sm ghost" onClick={run(() => toast('Reloaded the policy: 4 rules'))}>Reload</button></Row>
      <div className="srow wide"><pre className="code">{'network:\n  allow: [sandbox.pix-psp.com.br, localhost]\n  deny:  [api.cajui.com.br]   # production\ndatabases:\n  billing-prod: off\n  billing-staging: ask-before-write'}</pre></div></Section>
    <div className="callout info"><Icon n="info" /><span>The policy blocked one request today: Test Pix webhooks against the sandbox tried to call api.cajui.com.br.</span></div></> }
]
export const KEYS: [string, string][] = [['Command palette', 'Ctrl K'], ['New task', 'N'], ['Collapse the task list', 'Ctrl B'], ['Settings', 'Ctrl ,'], ['Conversation details', 'Ctrl I'], ['Deny', 'D'], ['Approve (hold when irreversible)', 'A'], ['Next approval', 'J'], ['Previous approval', 'K'], ['Back to now', 'L'], ['Send message', 'Enter'], ['New line', 'Shift Enter'], ['Stop the agent', 'Esc Esc'], ['Run query', 'Ctrl Enter']]

function PermissionsPage () {
  const revoke = (what: string) => run(() => toast(`Revoked: ${what}`, { undo: () => {} }))
  const hosts: [string, string, string][] = [['localhost:3002', 'allow', '3 calls today'], ['pix.sandbox.cajui.dev', 'allow', '2 calls today'], ['api.cajui.com.br', 'block', 'production · 1 call today'], ['downloads.example.org', 'ask', 'not encrypted · 1 call today']]
  return <>
    <Section title="Always allowed commands">
      <Row label={<><Av p="claude" size="s16" /><span className="mono">npm test</span></>} desc="Claude Code · cajui-api · project rule"><button className="btn sm ghost" onClick={revoke('npm test')}>Revoke</button></Row>
      <Row label={<><Av p="claude" size="s16" /><span className="mono">npm run lint</span></>} desc="Claude Code · cajui-api · project rule"><button className="btn sm ghost" onClick={revoke('npm run lint')}>Revoke</button></Row>
      <Row label={<><Av p="codex" size="s16" /><span className="mono">pnpm lint</span></>} desc="Codex · this session only"><button className="btn sm ghost" onClick={revoke('pnpm lint')}>Revoke</button></Row></Section>
    <Section title="Databases">{D.connections.map(c => <Row key={c.id} label={<>{c.name} <span className={'env ' + c.env}>{c.env}</span></>}><Sel label={`Agents on ${c.name}`} value={S.connAgent?.[c.id] ?? c.agent} onChange={v => { const was = S.connAgent?.[c.id] ?? c.agent; (S.connAgent ||= {})[c.id] = v; toast(`Agents on ${c.name}: ${v}`, { undo: () => { S.connAgent![c.id] = was; emit() } }); emit() }} opts={c.env === 'production' ? [['off', 'Nothing'], ['read', 'Read']] : [['off', 'Nothing'], ['read', 'Read'], ['confirm', 'Read, ask before writing'], ['write', 'Read and write']]} /></Row>)}</Section>
    <Section title="HTTP hosts">{hosts.map(([h, v, d]) => <Row key={h} label={<span className="mono">{h}</span>} desc={d}><Sel label={`Agents calling ${h}`} value={S.hostAgent?.[h] ?? v} onChange={nv => { (S.hostAgent ||= {})[h] = nv; toast(`${h}: ${nv === 'block' ? 'blocked' : nv === 'ask' ? 'asks first' : 'allowed'}`, { undo: () => { delete S.hostAgent![h]; emit() } }); emit() }} opts={[['allow', 'Allowed'], ['ask', 'Ask first'], ['block', 'Blocked']]} /></Row>)}</Section>
    <Section title="Always on"><Row label="Agents never write to production" desc="Can't be turned off." /><Row label="Deny is the default, and irreversible approvals need a hold" desc="Can't be turned off." /></Section></>
}

function ActivityPage () {
  const src = S.actSrc || 'all'
  type R = { k: string; when: string; by: string; task: string; what: ReactNode; res: ReactNode; open: () => void }
  const rows: R[] = []
  D.queries.forEach(q => rows.push({ k: 'db', when: q.at.slice(-8, -3) || q.at, by: q.by, task: task(q.task)?.title || 'Explain the settlement batch job', what: <span className="mono">{q.sql.split('\n')[0]}</span>, res: q.status === 'ok' ? <span className="res ok">Ran</span> : q.status === 'pending' && !S.resolved.ap_sql ? <span className="res attn">Waiting for you</span> : q.status === 'denied' ? <span className="res dz">Not allowed</span> : <span className="res ok">Decided</span>, open: () => { S.overlay = { type: 'dlg', id: 'qrow', q: q.id } } }))
  CALLS.forEach(c => rows.push({ k: 'net', when: c.at, by: c.by, task: task(c.t)?.key || c.t, what: <><span className={'meth ' + c.m}>{c.m}</span> <span className="mono">{c.host}{c.path}</span></>, res: c.prod ? <span className="res attn">Production</span> : c.st == null ? <span className="res">No status</span> : <span className={'res ' + (c.st >= 400 ? 'dz' : 'ok')}>{c.st}</span>, open: () => { S.http.sel = c.id; S.area = 'mode'; S.mode2 = 'code'; S.codeDock = 'http'; syncScreen() } }))
  D.containers.filter(c => c.task).forEach(c => rows.push({ k: 'box', when: '14:11', by: task(c.task)!.prov, task: task(c.task)!.key, what: <>Started {c.name}</>, res: c.status === 'running' ? <span className="res ok">Running</span> : <span className="res dz">Exited</span>, open: () => { S.pod.sel = c.id; S.area = 'mode'; S.mode2 = 'code'; S.codeDock = 'containers'; syncScreen() } }))
  Object.entries(D.changes).forEach(([tid, fs]) => fs.forEach(f => rows.push({ k: 'file', when: task(tid)!.started, by: task(tid)!.prov, task: task(tid)!.key, what: <span className="mono">{f.path}</span>, res: <span className="num"><span style={{ color: 'var(--success-fg)' }}>+{f.add}</span> <span style={{ color: 'var(--danger-fg)' }}>−{f.del}</span></span>, open: () => { S.taskId = tid; S.tab = 'changes'; S.area = 'task'; syncScreen() } })))
  const shown = rows.filter(r => src === 'all' || r.k === src)
  const n = (k: string) => rows.filter(r => r.k === k).length
  return <section className="ssec"><div className="ssec-h"><div className="chips">{([['all', 'All', rows.length], ['file', 'Changes', n('file')], ['db', 'Databases', n('db')], ['net', 'HTTP', n('net')], ['box', 'Containers', n('box')]] as const).map(([k, l, c]) => <button key={k} className="chip" style={{ height: 26 }} aria-pressed={src === k} onClick={run(() => { S.actSrc = k })}>{l} <small>{c}</small></button>)}</div></div>
    <table className="ctable act-t"><thead><tr><th>When</th><th /><th>Task</th><th>What</th><th>Result</th></tr></thead><tbody>{shown.map((r, i) => <tr key={i} className="click" tabIndex={0} onClick={run(r.open)} onKeyDown={e => { if (e.key === 'Enter') { r.open(); emit() } }}><td className="mono">{r.when}</td><td><Av p={r.by} size="s16" /></td><td className="mono">{r.task}</td><td className="stmt" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}><span className={'kdot ' + r.k} />{r.what}</td><td>{r.res}</td></tr>)}</tbody></table></section>
}

export function SettingsView () {
  if (S.view === 'loading') return <StateBlock kind="loading" />
  if (S.view === 'error') return <StateBlock kind="error" title="Couldn't load your settings" text="settings.json has a syntax error on line 14. Fix it, or reset to the defaults (your tasks aren't affected)." />
  const page = PAGES.find(p => p.id === S.page) || PAGES[0]
  const q = (S.sFilter || '').toLowerCase()
  const nav = (g: 'app' | 'ws') => PAGES.filter(p => p.group === g && (!q || (p.name + ' ' + p.desc).toLowerCase().includes(q))).map(p => { const b = p.badge?.()
    return <button key={p.id} aria-current={p.id === page.id ? 'page' : undefined} onClick={run(() => { S.page = p.id; syncScreen() })}><Icon n={p.icon} />{p.name}{b ? <span className="badge">{b}</span> : null}</button> })
  return <div className="setv"><nav className="set-nav" aria-label="Settings pages"><h2>Settings</h2>
    <label className="search mside-search" style={{ margin: '0 0 8px' }}><Icon n="search" s={12} /><input placeholder="Find a setting" aria-label="Find a setting" value={S.sFilter || ''} onChange={e => { S.sFilter = e.target.value; emit() }} /></label>
    <div className="slabel">Application</div>{nav('app')}<div className="slabel">Workspace · {D.company.name}</div>{nav('ws')}</nav>
    <div className="set-pg"><div className="set-in"><header><h1>{page.name}</h1><p>{page.desc}</p></header>{page.body()}<p className="muted" style={{ fontSize: 12 }}>Changes apply at once. Risky ones show an undo for 6 seconds.</p></div></div></div>
}
export const SETTINGS_PAGES = PAGES.map(p => ({ id: p.id, name: p.name, desc: p.desc }))
export { prov }
