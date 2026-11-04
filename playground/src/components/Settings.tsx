/* Settings on U2: every page uses the same row; changes apply at once. A change that widens what an agent can do,
   or that loses data, shows an undo toast. A delete that can't be undone keeps its confirmation dialog. */
import type { ReactNode } from 'react'
import { D } from '../mock/data'
import { S, emit, run, toast, plural, task, prov } from '../state/store'
import { Icon, Av, Kbd, StateBlock } from './ui'
import { syncScreen } from '../screens/registry'

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
  { id: 'agents', group: 'app', icon: 'sparkle', name: 'Agents', desc: 'Accounts, default models, custom agents and automations.', body: () => <>
    {Object.values(D.providers).map(p => <Section key={p.id} title={p.name} action={<span className="res ok">Signed in</span>}>
      <Row label={<><Av p={p.id} size="s16" />{p.account}</>} desc={`${p.plan} plan · ${p.id === 'claude' ? '41% of the 5 h window used' : 'usage resets at 21:00'}`}><button className="btn sm" onClick={dlg('accounts', { r: p.id })}>Manage…</button></Row>
      <Row label="Default model" desc="New tasks start with it; each task can change it."><Sel label={`${p.name} default model`} value={p.id === 'claude' ? S.set.claudeModel : S.set.codexModel} onChange={v => setVal(p.id === 'claude' ? 'claudeModel' : 'codexModel', v)} opts={p.models.map(m => [m, m])} /></Row>
      {p.id === 'claude' ? <Row label="Default effort"><Seg label="Default effort" value={S.set.claudeEffort} opts={p.efforts.map(e => [e, e] as [string, string])} onChange={v => setVal('claudeEffort', v)} /></Row> : null}</Section>)}
    <Section title="Agent for new tasks"><Row label="Start new tasks with"><Seg label="Agent for new tasks" value={S.set.defaultAgent} opts={[['claude', 'Claude Code'], ['codex', 'Codex']]} onChange={v => setVal('defaultAgent', v)} /></Row></Section>
    <Section title="Custom agents" action={<button className="btn sm" onClick={dlg('newagent')}><Icon n="plus" s={12} />New agent</button>}>
      <Row label="Migration reviewer" desc="Sonnet 5.5 · read only · uses the migrations skill"><button className="btn sm ghost" onClick={dlg('newagent')}>Edit</button></Row>
      <Row label="Release notes writer" desc="Haiku 5.5 · read only · uses release-notes"><button className="btn sm ghost" onClick={dlg('newagent')}>Edit</button></Row></Section>
    <Section title="Automations" action={<button className="btn sm" onClick={dlg('newauto')}><Icon n="plus" s={12} />New automation</button>}>
      <Row label="Nightly dependency check" desc="Every day at 02:00 · Codex · read only · opens a task when something is outdated">{<Switch on label="Nightly dependency check" onChange={() => toast('Paused the nightly dependency check', { undo: () => {} })} />}</Row>
      <Row label="Summarize Sentry errors" desc="Mondays at 08:00 · Claude · needs the sentry server, which has an expired token" tag={<span className="res dz" style={{ marginLeft: 6 }}>Failing</span>}><button className="btn sm" onClick={dlg('mcp')}>Fix</button></Row></Section></> },
  { id: 'approvals', group: 'app', icon: 'shield', name: 'Approvals and safety', desc: 'What agents may do without asking. Anything that widens it applies at once, with an undo.', badge: () => null, body: () => <>
    <Section title="Asking first">
      <Row label="Approve reads without asking" desc="Reading files, listing and searching. Writes, network calls and database changes always ask.">{sw('autoApproveReads', 'Approve reads without asking', ['Reads no longer ask', 'Reads ask again'])}</Row>
      <Row label="Network access" desc="Which hosts agents can call from commands and requests."><Sel label="Network access" value={S.set.network} onChange={v => setVal('network', v, v === 'any' ? 'Agents can call any host' : undefined)} opts={[['none', 'None'], ['ask', 'Ask for each new host'], ['allow', 'Allowed hosts only'], ['any', 'Any host']]} /></Row>
      <Row label="Access for new tasks"><Seg label="Access for new tasks" value={S.set.defaultAccess} opts={[['read', 'Read only'], ['edit', 'Can edit'], ['full', 'Full access']]} onChange={v => setVal('defaultAccess', v, v === 'full' ? 'New tasks start with full access' : undefined)} /></Row>
      <Row label="Skip approvals when resuming a session" desc={<>Resumed sessions keep running without asking. <span className="dz-t">Only for throwaway environments.</span></>}>{sw('bypassResume', 'Skip approvals when resuming', ['Resumed sessions no longer ask', 'Resumed sessions ask again'])}</Row></Section>
    <Section title="Databases"><div className="srow wide" style={{ paddingTop: 4 }}><p className="muted" style={{ fontSize: 12 }}>What agents may do on each OxeQuery connection.</p></div>
      {D.connections.map(c => <Row key={c.id} label={<>{c.name} <span className={'env ' + c.env}>{c.env}</span></>}><Sel label={`Agents on ${c.name}`} value={S.connAgent?.[c.id] ?? c.agent} onChange={v => { const was = S.connAgent?.[c.id] ?? c.agent; (S.connAgent ||= {})[c.id] = v; toast(`Agents on ${c.name}: ${v}`, { undo: () => { S.connAgent![c.id] = was; emit() } }); emit() }} opts={[['off', 'Nothing'], ['read', 'Read'], ['confirm', 'Read, ask before writing'], ['write', 'Read and write']]} /></Row>)}</Section>
    <Section title="Requests"><div className="srow wide" style={{ paddingTop: 4 }}><p className="muted" style={{ fontSize: 12 }}>What agents may do with each OxePost collection.</p></div>
      {D.collections.map(c => <Row key={c.id} label={c.name}><Sel label={`Agents on ${c.name}`} value={S.colAgent?.[c.id] ?? c.agent} onChange={v => { const was = S.colAgent?.[c.id] ?? c.agent; (S.colAgent ||= {})[c.id] = v; toast(`Agents on ${c.name}: ${v}`, { undo: () => { S.colAgent![c.id] = was; emit() } }); emit() }} opts={[['off', 'Nothing'], ['read', 'Send GET only'], ['confirm', 'Ask before sending'], ['write', 'Send anything']]} /></Row>)}</Section>
    <div className="callout info"><Icon n="info" /><span>An irreversible approval always needs a 1.2 s hold, and Deny is always the default. These can't be turned off.</span></div></> },
  { id: 'memory', group: 'app', icon: 'book', name: 'Memory', desc: 'What agents remember about this workspace between conversations. Beta, off until you turn it on.', body: () => <>
    <Section title="Memory (beta)"><Row label="Let agents remember" desc="Facts agents learn (commands, conventions, decisions) are kept per workspace and offered to new conversations.">{sw('memoryOn' as K, 'Let agents remember', ['Agents now remember this workspace', 'Agents stop remembering'])}</Row></Section>
    <Section title="Remembered" action={<button className="btn sm dtext" onClick={dlg('clearmemory')}>Clear memory…</button>}>{[['Run the API with npm run dev on :3001; tests with npm test -- <area>', 'Learned in T-142 · 14:40'], ['Migrations use CREATE INDEX CONCURRENTLY on big tables', 'Learned in T-143 · 14:21'], ['Never call api.cajui.com.br from tasks; use the sandbox', 'From the policy file']].map(([f, w]) => <Row key={f} label={f} desc={w}><button className="btn sm ghost" onClick={run(() => toast('Forgot that fact', { undo: () => {} }))}>Forget</button></Row>)}</Section></> },
  { id: 'notifications', group: 'app', icon: 'bell', name: 'Notifications', desc: 'When OXESpace and your phone get your attention.', body: () => <>
    <Section title="On this computer" action={<button className="btn sm" onClick={run(() => toast('Sent a test notification'))}>Send a test</button>}>
      <Row label="An agent needs you" desc="Approvals and questions. Recommended.">{sw('notifyApprovals', 'An agent needs you')}</Row>
      <Row label="A task finishes or stops">{sw('notifyDone', 'A task finishes or stops')}</Row>
      <Row label="Play a sound">{sw('notifySound', 'Play a sound')}</Row></Section>
    <Section title="On your phone"><Row label="Send approvals to paired phones" desc={`${plural(D.devices.length, 'phone')} paired. You can approve from the phone; irreversible ones need Face or fingerprint.`}><button className="btn sm" onClick={run(() => { S.page = 'devices'; syncScreen() })}>Devices</button></Row></Section></> },
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
  { id: 'tools', group: 'app', icon: 'plug', name: 'Tools and skills', desc: 'MCP servers and skills give agents more to work with. Turning one on applies at once, with an undo.', badge: () => '1', body: () => <>
    <Section title="MCP servers" action={<button className="btn sm" onClick={dlg('mcp')}><Icon n="plus" s={12} />Add server</button>}>{D.mcp.map(m => { const on = m.builtin || S.set.mcpOn[m.name]
      return <Row key={m.name} label={<><span className={'sdot ' + (m.status === 'err' ? 'bad' : on ? 'on' : 'off')} />{m.name}{m.builtin ? <Badge t="built in" /> : null}</>} desc={m.status === 'err' ? <span className="dz-t">{m.err}. Sign in again to use it.</span> : `${m.desc} · ${plural(m.tools, 'tool')}`}>
        {m.status === 'err' ? <button className="btn sm" onClick={run(() => toast('Opened the Sentry sign-in in your browser'))}>Sign in</button> : null}<Switch on={!!on} risky={!on} disabled={m.builtin} label={`Turn ${m.name} ${on ? 'off' : 'on'}`} onChange={() => { S.set.mcpOn[m.name] = !on; toast(`${m.name} turned ${on ? 'off' : 'on'}`, { undo: () => { S.set.mcpOn[m.name] = !!on; emit() } }); emit() }} /></Row> })}</Section>
    <Section title="Sites the browser has seen"><Row label="localhost:3002" desc="Opened by T-141 · today"><button className="btn sm ghost" onClick={run(() => toast('Removed localhost:3002', { undo: () => {} }))}>Remove</button></Row><Row label="sandbox.pix-psp.com.br" desc="Opened by T-144 · today"><button className="btn sm ghost" onClick={run(() => toast('Removed sandbox.pix-psp.com.br', { undo: () => {} }))}>Remove</button></Row></Section>
    <Section title="Skills" action={<button className="btn sm" onClick={dlg('skills')}><Icon n="plus" s={12} />Browse skills</button>}>{D.skills.map(k => { const on = S.set.skillOn[k.name]
      return <Row key={k.name} label={<>{k.name} <Badge t={k.scope === 'project' ? 'this workspace' : 'all workspaces'} /></>} desc={k.desc}><Switch on={on} risky={!on} label={`Turn ${k.name} ${on ? 'off' : 'on'}`} onChange={() => { S.set.skillOn[k.name] = !on; toast(`Skill ${k.name} turned ${on ? 'off' : 'on'}`, { undo: () => { S.set.skillOn[k.name] = on; emit() } }); emit() }} /></Row> })}</Section></> },
  { id: 'devices', group: 'app', icon: 'phone', name: 'Phone and devices', desc: 'Follow tasks and approve from your phone with the OXESpace Android app.', body: () => <>
    <Section title="Paired" action={<button className="btn sm" onClick={dlg('pair')}><Icon n="plus" s={12} />Pair a phone</button>}>{(S.unpaired ? D.devices.filter(d => !S.unpaired!.includes(d.name)) : D.devices).map(d => <Row key={d.name} label={<><Icon n="phone" s={12} />{d.name}</>} desc={`${d.os} · paired ${d.paired} · ${d.last}`}><button className="btn sm ghost dtext" onClick={dlg('unpair', { c: d.name })}>Unpair…</button></Row>)}</Section>
    <div className="callout info"><Icon n="lock" /><span>Phones connect through your own relay with end-to-end encryption. Nothing about your code leaves your computers.</span></div></> },
  { id: 'data', group: 'app', icon: 'archive', name: 'Data and privacy', desc: 'What OXESpace keeps on this computer, and for how long.', body: () => <>
    <Section title="History"><Row label="Keep conversations and checkpoints" desc="Older ones are deleted, except pinned tasks."><Sel label="Keep history for" value={S.set.retention} onChange={v => setVal('retention', v, Number(v) < Number(S.set.retention) ? `History older than ${v} days will be deleted tonight` : undefined)} opts={[['30', '30 days'], ['90', '90 days'], ['365', '1 year'], ['0', 'Forever']]} /></Row>
      <Row label="Clear history" desc="Deletes every archived task, its conversation and its checkpoints (2.1 GB)."><button className="btn sm dtext" onClick={dlg('clearhistory')}>Clear history…</button></Row></Section>
    <Section title="Sharing"><Row label="Send crash reports" desc="Stack traces and versions, never file contents or prompts.">{sw('crashReports', 'Send crash reports')}</Row>
      <Row label="Send usage statistics" desc="Which features are used, counted. Off by default.">{sw('sendTelemetry', 'Send usage statistics')}</Row></Section></> },
  { id: 'activity', group: 'app', icon: 'activity', name: 'Agent activity', desc: 'Everything agents did outside the conversation, from every mode, in one list (U12).', badge: () => S.resolved.ap_sql ? null : '1', body: () => <ActivityPage /> },
  { id: 'diagnostics', group: 'app', icon: 'cpu', name: 'Diagnostics', desc: 'Checks to run when something doesn\'t work.', body: () => <>
    <Section title="Health" action={<button className="btn sm" onClick={run(() => toast('Checked again: 6 passed, 1 warning'))}><Icon n="refresh" s={12} />Check again</button>}>{([['Claude Code CLI', 'ok', '2.4.1 on PATH'], ['Codex CLI', 'ok', '0.61.0 on PATH'], ['Docker', 'ok', 'Docker Desktop 4.36'], ['Git', 'ok', '2.47.1'], ['Code search index', 'ok', 'cajui-api · 1,912 files'], ['Local database', 'ok', '84 MB · last backup 03:00'], ['sentry MCP server', 'warn', 'Token expired on 01/11']] as const).map(([n, s, d]) => <Row key={n} label={<><span className={'sdot ' + (s === 'ok' ? 'on' : 'wait')} />{n}</>} desc={d} />)}</Section>
    <Section title="Logs"><Row label="Main process log" desc="~/.oxespace/logs/main.log · 2.4 MB"><button className="btn sm" onClick={run(() => toast('Opened the logs folder'))}>Open folder</button></Row><Row label="Report a problem" desc="Includes versions and the last 200 log lines, never file contents."><button className="btn sm" onClick={dlg('report')}>Report…</button></Row></Section></> },
  { id: 'about', group: 'app', icon: 'info', name: 'About', desc: 'Version and licenses.', body: () => <Section title="OXESpace"><Row label="Version 1.5.0" desc="Electron 39 · Node 22.11 · Windows 11" /><Row label="Third-party licenses" desc="174 packages"><button className="btn sm" onClick={dlg('about')}>View</button></Row><Row label="Shortcuts"><button className="btn sm" onClick={dlg('shortcuts')}>Show all</button></Row></Section> },
  { id: 'ws-projects', group: 'ws', icon: 'folder', name: 'Projects', desc: `The folders in ${D.company.name}.`, body: () => <Section title="Projects" action={<button className="btn sm" onClick={dlg('addproject')}><Icon n="plus" s={12} />Add project</button>}>{Object.values(D.projects).filter(p => !S.removedProj?.includes(p.id)).map(p => <Row key={p.id} label={p.name} desc={<><span className="mono">{p.path}</span> · {p.stack}</>}><button className="btn sm ghost" onClick={run(() => { (S.removedProj ||= []).push(p.id); toast(`Removed ${p.name} from the workspace. The folder stays on disk.`, { undo: () => { S.removedProj = S.removedProj!.filter(x => x !== p.id); emit() } }) })}>Remove</button></Row>)}</Section> },
  { id: 'ws-policy', group: 'ws', icon: 'shield', name: 'Policy', desc: 'Rules every agent in this workspace follows, from a file in the repository.', body: () => <>
    <Section title="Policy file"><Row label={<span className="mono">cajui-api/.oxespace/policy.yaml</span>} desc="Loaded at 14:02 · 4 rules"><button className="btn sm" onClick={run(() => toast('Opened policy.yaml in your editor'))}>Open in editor</button><button className="btn sm ghost" onClick={run(() => toast('Reloaded the policy: 4 rules'))}>Reload</button></Row>
      <div className="srow wide"><pre className="code">{'network:\n  allow: [sandbox.pix-psp.com.br, localhost]\n  deny:  [api.cajui.com.br]   # production\ndatabases:\n  billing-prod: off\n  billing-staging: ask-before-write'}</pre></div></Section>
    <div className="callout info"><Icon n="info" /><span>The policy blocked one request today: T-144 tried to call api.cajui.com.br.</span></div></> }
]
export const KEYS: [string, string][] = [['Command palette', 'Ctrl K'], ['New task', 'N'], ['Side chat', 'Ctrl .'], ['Collapse the task list', 'Ctrl B'], ['Settings', 'Ctrl ,'], ['Conversation details', 'Ctrl I'], ['Deny', 'D'], ['Approve (hold when irreversible)', 'A'], ['Snapshot, then approve', 'S'], ['Next approval', 'J'], ['Previous approval', 'K'], ['Back to now', 'L'], ['Send message', 'Enter'], ['New line', 'Shift Enter'], ['Stop the agent', 'Esc Esc'], ['Run query', 'Ctrl Enter']]

function ActivityPage () {
  const src = S.actSrc || 'all'
  type R = { k: string; when: string; by: string; task: string; what: ReactNode; res: ReactNode; open: () => void }
  const rows: R[] = []
  D.queries.forEach(q => rows.push({ k: 'db', when: q.at.slice(-8, -3) || q.at, by: q.by, task: task(q.task)?.key || 'T-138', what: <span className="mono">{q.sql.split('\n')[0]}</span>, res: q.status === 'ok' ? <span className="res ok">Ran</span> : q.status === 'pending' && !S.resolved.ap_sql ? <span className="res attn">Waiting for you</span> : q.status === 'denied' ? <span className="res dz">Not allowed</span> : <span className="res ok">Decided</span>, open: () => { S.overlay = { type: 'dlg', id: 'qrow', q: q.id } } }))
  Object.values(D.requests).filter(r => r.task).forEach(r => rows.push({ k: 'net', when: r.at!.slice(0, 5), by: r.by!, task: task(r.task!)!.key, what: <>{r.method} {r.name}</>, res: r.blocked ? <span className="res dz">Blocked</span> : <span className="res ok">{r.status}</span>, open: () => { S.overlay = { type: 'dlg', id: 'prow', r: r.id } } }))
  D.containers.filter(c => c.task).forEach(c => rows.push({ k: 'box', when: '14:11', by: task(c.task)!.prov, task: task(c.task)!.key, what: <>Started {c.name}</>, res: c.status === 'running' ? <span className="res ok">Running</span> : <span className="res dz">Exited</span>, open: () => { S.pod.sel = c.id; S.area = 'mode'; S.mode2 = 'pod'; syncScreen() } }))
  Object.entries(D.changes).forEach(([tid, fs]) => fs.forEach(f => rows.push({ k: 'file', when: task(tid)!.started, by: task(tid)!.prov, task: task(tid)!.key, what: <span className="mono">{f.path}</span>, res: <span className="num"><span style={{ color: 'var(--success-fg)' }}>+{f.add}</span> <span style={{ color: 'var(--danger-fg)' }}>−{f.del}</span></span>, open: () => { S.taskId = tid; S.tab = 'changes'; S.area = 'task'; syncScreen() } })))
  const shown = rows.filter(r => src === 'all' || r.k === src)
  const n = (k: string) => rows.filter(r => r.k === k).length
  return <section className="ssec"><div className="ssec-h"><div className="chips">{([['all', 'All', rows.length], ['file', 'Changes', n('file')], ['db', 'Databases', n('db')], ['net', 'Requests', n('net')], ['box', 'Containers', n('box')]] as const).map(([k, l, c]) => <button key={k} className="chip" style={{ height: 26 }} aria-pressed={src === k} onClick={run(() => { S.actSrc = k })}>{l} <small>{c}</small></button>)}</div></div>
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
