/* OxeMobile 1.5: the Android app on the Mandacaru 1.5 identity. Mock data only (mock/phone.ts). Every screen and
   state from the 1.4.2 goldens, plus Agents (S7.1) and Settings, which had none. No protocol change: the phone shows
   what C5 already sends. The safety rules stay as they are:
   - biometric (fingerprint or screen lock) on every answer;
   - kinds the phone can't answer are answered on the computer;
   - a critical request's Allow unlocks after 2 s;
   - hidden characters are shown, never rendered. */
import { useEffect, useRef, type ReactNode } from 'react'
import { S, emit } from '../state/store'
import { syncScreen } from '../screens/registry'
import { Icon } from './ui'
import { CACTUS } from './icons'
import { PC, THREADS, REQUESTS, QUESTIONS, AGENTS, AWORD, TERMINALS, JOBS, VT_ROWS, VT_COLS, type PThread, type PRequest, type AState, type Risk } from '../mock/phone'

/* ------------------------------------------------------------------ state */
export interface PhoneState { scr: string; st: string; tab: string; req: string; qi: number; qa: Record<number, string[]>; hold: number; bio: '' | 'ask' | 'ok'; bioAct: 'allow' | 'deny' | 'send'; answered: string; answeredHow: 'allow' | 'deny' | 'send' | ''; draft: string; steers: string[]; termDraft: string; tview: 'conv' | 'screen'; fit: boolean; unpairAsk: boolean; themes: 'both' | 'one'; notif: Record<string, boolean>; appearance: string }
export const PH0 = (): PhoneState => ({ scr: 'home', st: 'unpaired', tab: 'threads', req: 'r-vol', qi: 0, qa: {}, hold: 0, bio: '', bioAct: 'allow', answered: '', answeredHow: '', draft: '', steers: [], termDraft: '', tview: 'conv', fit: false, unpairAsk: false, themes: 'both', notif: { needs: true, done: true, failed: true }, appearance: 'system' })
const P = () => (S.ph ||= PH0()) as PhoneState
/** Each screen's states, in the order of the 1.4.2 goldens (plus the new ones). */
export const PHONE_STATES: Record<string, [string, string][]> = {
  home: [['unpaired', 'Not paired'], ['connecting', 'Connecting'], ['unreachable', 'Can\'t reach'], ['offline', 'No Wi-Fi'], ['incompatible', 'Other version'], ['revoked', 'Removed'], ['lapsed', 'Pairing expired']],
  pair: [['scanning', 'Scan'], ['bad-code', 'Code outside the network'], ['local-network-ask', 'Ask local network'], ['local-network-denied', 'Local network off'], ['local-network-blocked', 'Blocked'], ['contacting', 'Contacting'], ['waiting', 'Confirm the code'], ['refused-on-computer', 'Refused at the computer'], ['code-expired', 'Code expired'], ['refused-by-computer', 'Connection refused'], ['timed-out', 'Timed out'], ['unreachable', 'No route'], ['wrong-certificate', 'Wrong certificate'], ['paired', 'Paired']],
  live: [['threads', 'Conversations'], ['needs', 'Needs you'], ['agents', 'Agents'], ['terminals', 'Terminals'], ['tasks', 'Tasks'], ['empty', 'Empty'], ['reconnecting', 'Reconnecting']],
  thread: [['thread', 'Needs you'], ['working', 'Working'], ['finished', 'Finished'], ['loading', 'Loading']],
  request: [['r-vol', 'Critical (2 s, biometric)'], ['r-hid', 'Hidden characters'], ['r-q', 'Questions'], ['r-sql', 'Answer on the computer'], ['r-cut', 'Cut short (deny only)'], ['r-cutq', 'Cut-short question'], ['gone', 'No longer waiting'], ['levels', 'Risk levels']],
  terminal: [['typing', 'You can type'], ['read-only', 'Read-only'], ['loading', 'Loading'], ['conversation', 'Agent conversation'], ['conv-new', 'New while scrolled up'], ['conv-gone', 'Conversation gone']],
  settings: [['settings', 'Settings']]
}
/** Every action inside the phone re-renders and keeps the playground's hash in step. */
const run = (fn: () => void) => () => { fn(); syncScreen(); emit() }
export function phoneGo (scr: string, st?: string) { const p = P(); p.scr = scr; p.st = st || PHONE_STATES[scr][0][0]; if (scr === 'live') p.tab = ['empty', 'reconnecting'].includes(p.st) ? 'threads' : p.st; if (scr === 'request' && !['gone', 'levels'].includes(p.st)) p.req = p.st; p.hold = 0; p.bio = ''; p.answered = ''; p.answeredHow = ''; p.qi = 0; p.unpairAsk = false; p.steers = []; p.draft = ''; p.tview = 'conv' }

/* ------------------------------------------------------------------ building blocks */
const Mark = ({ size = 28 }: { size?: number }) => <span className="m-mark" style={{ width: size, height: size }} aria-hidden="true"><svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: CACTUS }} /></span>
const Btn = ({ kind = 'pri', icon, children, onClick, disabled, full = true }: { kind?: 'pri' | 'sec' | 'ghost' | 'danger'; icon?: string; children: ReactNode; onClick?: () => void; disabled?: boolean; full?: boolean }) =>
  <button className={`m-btn ${kind}${full ? ' full' : ''}`} disabled={disabled} onClick={onClick ? run(onClick) : undefined}>{icon ? <Icon n={icon} s={16} /> : null}<span>{children}</span></button>
function Notice ({ intent, icon, title, children, actions }: { intent: 'info' | 'warning' | 'danger' | 'ok'; icon: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return <section className={'m-notice ' + intent} role={intent === 'danger' ? 'alert' : 'status'}><span className="ni"><Icon n={icon} s={16} /></span><div><b>{title}</b>{children ? <p>{children}</p> : null}{actions ? <div className="na">{actions}</div> : null}</div></section>
}
const Glyph = ({ s }: { s: string }) => <span className={'m-sg g-' + s} aria-hidden="true" />
const Av = ({ p }: { p: string }) => <span className={'m-av ' + p} aria-hidden="true">{p === 'claude' ? 'C' : 'X'}</span>
const WsChip = ({ name }: { name: string }) => <span className="m-ws" title="Workspace">{name}</span>
const RISK: Record<Risk, [string, string]> = { low: ['Low', 'Only reads'], medium: ['Medium', 'Changes something'], high: ['High', 'Deletes, escalates access or publishes'], critical: ['Critical', "Can't be undone, or affects production"] }
const RiskChip = ({ r }: { r: Risk }) => <span className={'m-risk ' + r}><Icon n={r === 'critical' ? 'warn' : r === 'high' ? 'shieldx' : 'shield'} s={12} />{RISK[r][0]}</span>
const THREAD_GLYPH: Record<string, string> = { approval: 'needs', running: 'run', idle: 'done', interrupted: 'stopped', failed: 'err' }
/** The S7.1 words, the same as Agents (HML-M1-4): an idle conversation whose last turn completed is Finished. */
const THREAD_WORD: Record<string, string> = { approval: 'Needs you', running: 'Working', idle: 'Finished', interrupted: 'Stopped', failed: 'Failed' }
const AGLYPH: Record<AState, string> = { 'needs-you': 'needs', failed: 'err', working: 'run', finished: 'done', idle: 'idle', stopped: 'stopped', unknown: 'unknown' }

function AppBar ({ back, title, sub, right }: { back?: () => void; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return <header className="m-bar">{back ? <button className="m-ib" aria-label="Back" onClick={run(back)}><Icon n="back" s={16} /></button> : <Mark size={30} />}
    <div className="m-bt"><h1>{title}</h1>{sub ? <div className="m-bs">{sub}</div> : null}</div>{right}</header>
}
const Gear = () => <button className="m-ib" aria-label="Settings" onClick={run(() => phoneGo('settings'))}><Icon n="gear" s={16} /></button>
const PcSub = ({ state }: { state: 'on' | 'wait' | 'off' }) => <span className="m-pc"><span className={'m-dot ' + state} />{state === 'on' ? 'Connected over Wi-Fi' : state === 'wait' ? 'Reconnecting…' : 'Not connected'}</span>

/* ------------------------------------------------------------------ M1 home */
function Home () {
  const st = P().st
  if (st === 'unpaired' || st === 'revoked' || st === 'lapsed') return <div className="m-scr m-hero-wrap">
    {st === 'revoked' ? <div className="m-pad"><Notice intent="danger" icon="shieldx" title={`${PC.name} removed this phone`}>Pair again to follow and answer your sessions.</Notice></div> : st === 'lapsed' ? <div className="m-pad"><Notice intent="warning" icon="clock" title="This pairing expired">This pairing expired before the phone connected. Pair again.</Notice></div> : null}
    <div className="m-hero"><Mark size={64} /><div className="m-word">OXESpace</div>
      <h1 className="m-display">Your desktop,<br />in your pocket</h1>
      <p className="m-lead">Pair this phone with OXESpace on your computer to follow your agents and answer what needs you.</p>
      <ul className="m-feats"><li><Icon n="m-chat" s={16} /><span><b>Follow every conversation</b>What each agent is doing, as it happens.</span></li><li><span className="m-sunbadge" aria-hidden="true" /><span><b>Answer what needs you</b>Approvals and questions, with your fingerprint.</span></li><li><Icon n="m-code" s={16} /><span><b>Watch your terminals</b>Live, and type where the computer allows it.</span></li></ul></div>
    <div className="m-foot"><Btn icon="qr" onClick={() => phoneGo('pair')}>Pair with your computer</Btn><p className="m-fine"><Icon n="wifi" s={12} />Same Wi-Fi only. Nothing goes through a server.</p></div></div>
  const pcState = st === 'connecting' ? 'wait' : 'off'
  return <div className="m-scr"><AppBar title={PC.name} sub={<PcSub state={pcState} />} right={<Gear />} />
    <div className="m-body m-pad">
      <section className="m-pccard"><span className="m-pci"><Icon n="monitor" s={16} /></span><div><b>{PC.name}</b><span>{PC.os} · paired {PC.since}</span></div><span className={'m-dot ' + pcState} /></section>
      {st === 'connecting' ? <><div className="m-connect" role="status"><span className="m-spin" aria-hidden="true" />Connecting to {PC.name}…</div><div className="m-skel-list" aria-hidden="true">{[0, 1, 2].map(i => <div key={i}><i /><i /></div>)}</div></>
        : st === 'unreachable' ? <Notice intent="warning" icon="wifi" title={`Can't reach ${PC.name}`} actions={<><Btn onClick={() => {}}>Try again</Btn><Btn kind="sec" icon="wifi" onClick={() => {}}>Open Wi-Fi settings</Btn></>}>Check that it's on, on the same Wi-Fi, and that the phone connection is on in Settings › Devices.<span className="m-retry"><span className="m-ring" style={{ ['--p' as string]: '60%' }} />Trying again in 8 s</span></Notice>
        : st === 'offline' ? <Notice intent="info" icon="wifi-off" title="This phone isn't on Wi-Fi" actions={<Btn kind="sec" icon="wifi" onClick={() => {}}>Open Wi-Fi settings</Btn>}>{PC.name} can only be reached on the same Wi-Fi network. It reconnects when you're back.</Notice>
          : <Notice intent="danger" icon="refresh" title="Different versions" actions={<Btn onClick={() => {}}>Update the app</Btn>}>{PC.name} uses a different version of OXESpace. Update the app here, or OXESpace on your computer.</Notice>}
      {st !== 'connecting' ? <Btn kind="ghost" onClick={() => {}}>Enter the computer's address</Btn> : null}
    </div></div>
}

/* ------------------------------------------------------------------ M2 pairing */
const STEP: Record<string, number> = { 'refused-on-computer': 2, 'code-expired': 1, scanning: 0, 'bad-code': 0, 'local-network-ask': 0, 'local-network-denied': 0, 'local-network-blocked': 1, contacting: 1, waiting: 2, 'refused-by-computer': 1, 'timed-out': 1, unreachable: 1, 'wrong-certificate': 1, paired: 3 }
function Steps ({ at, failed }: { at: number; failed?: boolean }) {
  return <ol className="m-steps" aria-label="Pairing steps">{['Scan', 'Reach', 'Confirm', 'Done'].map((l, i) => <li key={l} className={(i < at ? 'done' : i === at ? (failed ? 'fail' : 'now') : '')} aria-current={i === at ? 'step' : undefined}><span>{i < at ? <Icon n="check" s={12} /> : i === at && failed ? <Icon n="x" s={12} /> : i + 1}</span>{l}</li>)}</ol>
}
const Path = () => <span className="m-path"><span>OXESpace</span>›<span>Settings</span>›<span>Devices</span></span>
function Finder ({ problem }: { problem?: boolean }) { return <div className={'m-finder' + (problem ? ' bad' : '')} aria-label="Camera"><i className="c1" /><i className="c2" /><i className="c3" /><i className="c4" />{problem ? null : <b className="m-scanline" />}<span><Icon n="qr" s={16} />Point at the code on your computer</span></div> }
function Pair () {
  const st = P().st; const fail = ['refused-on-computer', 'code-expired', 'refused-by-computer', 'timed-out', 'unreachable', 'wrong-certificate', 'local-network-blocked'].includes(st)
  const FAILS: Record<string, [string, string, string]> = {
    'refused-on-computer': ['danger', `Pairing was refused on ${PC.name}`, 'Someone pressed Refuse on the computer. If that was a mistake, show the code again there and scan it.'],
    'code-expired': ['warning', 'This code expired', 'The code expired. Show a new one on your computer and scan it within 2 minutes.'],
    'refused-by-computer': ['danger', 'Your computer refused the connection', 'Check that the phone connection is on in Settings › Devices. If a third-party firewall such as McAfee or Norton is installed, allow OXESpace in it too: it can refuse connections even when Windows Firewall allows them.'],
    'timed-out': ['warning', 'Your computer didn\'t answer', 'It never got the request. On Windows, the firewall blocks the phone when the Wi-Fi is set to Public: set the network to Private, or allow OXESpace through the firewall. Also check that both are on the same Wi-Fi.'],
    unreachable: ['warning', 'No route to your computer', 'Check that this phone is on the same Wi-Fi as the computer, not on mobile data, and that no VPN is on.'],
    'wrong-certificate': ['danger', 'Another device answered', 'Another device answered at that address, not your computer. Nothing was sent. Check that you\'re on your own Wi-Fi.'],
    'local-network-blocked': ['danger', 'Android blocked the connection', 'Local network access is off for OXESpace. Turn it on in the app\'s settings (Permissions), then scan again.']
  }
  return <div className="m-scr"><AppBar back={() => phoneGo('home')} title="Pair with your computer" />
    <div className="m-body m-pad"><Steps at={STEP[st] ?? 0} failed={fail} />
      {st === 'scanning' || st === 'bad-code' ? <><p className="m-text">On your computer, open <Path />, turn on the phone connection, and point the camera at the code shown there.</p><Finder problem={st === 'bad-code'} />
        {st === 'bad-code' ? <Notice intent="warning" icon="wifi" title="This code points outside your local network">OXESpace only pairs on the same Wi-Fi.</Notice> : null}</>
        : st === 'local-network-ask' ? <><Notice intent="info" icon="wifi" title="Local network access">OXESpace talks to your computer directly over your Wi-Fi, so Android asks whether it may use the local network. It connects only to the computer you pair with, never to other devices.</Notice><Btn onClick={() => {}}>Allow local network access</Btn></>
          : st === 'local-network-denied' ? <Notice intent="warning" icon="lock" title="Local network access is off" actions={<Btn kind="sec" onClick={() => {}}>Open app settings</Btn>}>Android blocks every connection to your computer until you turn on "Local network access" for OXESpace in the app's settings (Permissions).</Notice>
            : st === 'contacting' ? <div className="m-reach" role="status"><div className="m-reach-art" aria-hidden="true"><span><Icon n="phone" s={16} /></span><i /><i /><i /><span><Icon n="monitor" s={16} /></span></div><h2 className="m-h2">Contacting {PC.name}…</h2><div className="m-wait"><span className="m-spin" aria-hidden="true" />Waiting for the computer</div><p className="m-text">Reaching your computer over the Wi-Fi. Once it has the request, it asks you to confirm and this phone shows the code to compare.</p></div>
              : st === 'waiting' ? <div className="m-confirm"><h2 className="m-h2">Confirm on your computer</h2><p className="m-text">{PC.name} is asking whether to pair with this phone. Accept only if it shows this code:</p>
                <div className="m-code" aria-label="Code 2 8 T 5 C Y">{'28T5CY'.split('').map((c, i) => <span key={i} className={i === 3 ? 'gap' : ''}>{c}</span>)}</div>
                <p className="m-fp"><Icon n="lock" s={12} />Certificate 4F:A2:91:0C · matches the one under the QR</p><div className="m-wait" role="status"><span className="m-spin" aria-hidden="true" />Waiting for you to accept on the computer</div><Btn kind="ghost" onClick={() => phoneGo('pair', 'scanning')}>Cancel pairing</Btn><p className="m-fine">Cancel closes the request, so the computer's prompt closes too.</p></div>
                : st === 'paired' ? <div className="m-success"><span className="m-medal" aria-hidden="true"><Icon n="check" s={16} /></span><h2 className="m-h2">Paired with {PC.name}</h2><p className="m-text">You'll see its conversations, what needs you and its terminals. Every answer asks for your fingerprint or screen lock.</p><Btn onClick={() => phoneGo('live', 'threads')}>Done</Btn></div>
                  : <Notice intent={FAILS[st][0] as 'danger'} icon={st === 'code-expired' ? 'clock' : st === 'refused-on-computer' ? 'x' : FAILS[st][0] === 'danger' ? 'shieldx' : 'wifi'} title={FAILS[st][1]} actions={<Btn icon="qr" onClick={() => phoneGo('pair', 'scanning')}>Scan again</Btn>}>{FAILS[st][2]}</Notice>}
    </div></div>
}

/* ------------------------------------------------------------------ M3 live (+ M7 agents) */
const TABS: [string, string, string][] = [['threads', 'm-chat', 'Conversations'], ['needs', 'sun', 'Needs you'], ['agents', 'agora', 'Agents'], ['terminals', 'm-code', 'Terminals'], ['tasks', 'list', 'Tasks']]
function ThreadRow ({ t }: { t: PThread }) {
  return <button className="m-row" onClick={run(() => phoneGo('thread', t.status === 'approval' ? 'thread' : t.status === 'running' ? 'working' : 'finished'))}>
    <Glyph s={THREAD_GLYPH[t.status]} /><span className="m-rm"><b className="m-trunc">{t.title}</b><span className="m-rs"><Av p={t.prov} /><WsChip name={t.ws} /><span>{THREAD_WORD[t.status]}{t.bg ? ` · ${t.bg} in background` : ''}</span></span>{t.ask ? <span className="m-ask">{t.ask}</span> : null}</span><span className="m-time">{t.at}</span></button>
}
function Live () {
  const p = P(); const tab = p.tab; const empty = p.st === 'empty'; const recon = p.st === 'reconnecting'
  const needsN = REQUESTS.filter(r => r.id !== p.answered).length
  return <div className="m-scr"><AppBar title={PC.name} sub={<PcSub state={recon ? 'wait' : 'on'} />} right={<Gear />} />
    {recon ? <div className="m-banner" role="status"><span className="m-spin" aria-hidden="true" />Connection to {PC.name} lost. Reconnecting… What you see may be a minute old.</div> : null}
    <div className="m-body">{tab === 'threads' ? (empty ? <div className="m-empty"><span className="m-ei"><Icon n="m-chat" s={16} /></span><h2 className="m-h2">No conversations yet</h2><p className="m-text">Start one on {PC.name}. It shows up here as soon as it does.</p></div>
      : <div className="m-list" role="list">{THREADS.map(t => <div role="listitem" key={t.id}><ThreadRow t={t} /></div>)}</div>)
      : tab === 'needs' ? <div className="m-list m-pad-t">{REQUESTS.filter(r => r.id !== p.answered).map(r => { const t = THREADS.find(x => x.id === r.thread)!
        return <button key={r.id} className="m-card" onClick={run(() => phoneGo('request', r.id))}><span className="m-ch">{r.kind === 'question' ? <span className="m-q">Question</span> : <RiskChip r={r.risk!} />}{r.answerable ? null : <span className="m-onpc"><Icon n="monitor" s={12} />On the computer</span>}{r.truncated ? <span className="m-cut">Cut short</span> : null}<span className="m-time">{r.at}</span></span><b>{r.id === 'r-q' ? `${t.title} asks you 2 questions` : r.title}</b><span className="m-rs"><Av p={t.prov} /><span className="m-trunc">{t.title}</span></span></button> })}
        {!needsN ? <div className="m-empty"><span className="m-ei ok"><Icon n="check" s={16} /></span><h2 className="m-h2">Nothing needs you</h2></div> : null}</div>
        : tab === 'agents' ? <div className="m-pad-t"><div className="m-pad-x"><Notice intent="info" icon="info" title="Some agents couldn't be read right now.">The rest is up to date.</Notice></div>
          <div className="m-list" role="list">{AGENTS.map(a => <div role="listitem" key={a.id} className={'m-row m-arow' + (a.parent ? ' nested' : '')}><Glyph s={AGLYPH[a.state]} /><span className="m-rm"><b className="m-trunc">{a.title}</b><span className="m-rs"><Av p={a.prov} /><span className={'m-st ' + a.state}>{AWORD[a.state]}</span><span className="m-kind">{a.kind === 'thread' ? 'chat' : a.kind === 'pane' ? 'terminal' : a.kind === 'delegation' ? 'delegated' : 'work'}</span></span>{a.parent ? <span className="m-sub">delegated by {a.parent}</span> : null}</span><span className="m-time">{a.since.replace('for ', '').replace('since ', '')}</span></div>)}</div></div>
          : tab === 'terminals' ? <div className="m-pad m-stack">{TERMINALS.map(g => <section key={g.ws} className="m-group"><h2><WsChip name={g.ws} /><span className="m-time">{g.panes.length === 1 ? '1 terminal' : `${g.panes.length} terminals`}</span></h2>
            {g.panes.map(k => <button key={k.id} className="m-row m-trow" onClick={run(() => phoneGo('terminal', k.typing ? 'typing' : 'read-only'))}>{k.agent ? <Av p={k.agent} /> : <span className="m-tico"><Icon n="term" s={12} /></span>}<span className="m-rm"><b>{k.title}</b><span className="m-rs">{k.state ? <span>{k.state}</span> : null}{k.typing ? <span className="m-type"><Icon n="keyboard" s={12} />You can type</span> : <span className="m-ro"><Icon n="eye" s={12} />Read-only</span>}</span></span><Icon n="right" s={12} /></button>)}</section>)}</div>
            : <div className="m-pad m-stack"><section className="m-group"><h2><span>Background jobs</span></h2>{JOBS.map(j => <div key={j.title} className="m-row"><Glyph s={j.state === 'running' ? 'run' : j.state === 'failed' ? 'err' : 'done'} /><span className="m-rm"><b>{j.title}</b><span className="m-rs"><span>{j.state === 'running' ? 'Running' : j.state === 'failed' ? 'Failed' : 'Finished'}</span><span>{j.sub}</span></span></span></div>)}</section>
              <section className="m-group"><h2><span>Delegated work</span></h2><div className="m-row"><Glyph s="run" /><span className="m-rm"><b>Review the refund migration</b><span className="m-rs"><Av p="codex" /><span>Running · from Add a Pix refund endpoint</span></span></span></div></section></div>}
    </div>
    <nav className="m-nav" aria-label="Sections">{TABS.map(([id, ic, l]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={run(() => { p.tab = id; p.st = id })}><span className="m-ni"><Icon n={ic === 'sun' ? 'bell' : ic} s={16} />{id === 'needs' && needsN ? <span className="m-badge">{needsN}</span> : null}</span>{l}</button>)}</nav></div>
}

/* ------------------------------------------------------------------ M4 conversation */
function Thread () {
  const st = P().st; const p = P(); const working = st === 'working'; const finished = st === 'finished'
  const title = finished ? 'Add CSV export to the statements page' : working ? 'Make charge creation idempotent' : 'Test Pix webhooks against the sandbox'
  return <div className="m-scr"><AppBar back={() => phoneGo('live', 'threads')} title={title} sub={st === 'loading' ? null : <span className="m-now-s"><Glyph s={working ? 'run' : finished ? 'done' : 'needs'} />{working ? 'Working · 44 min' : finished ? 'Finished · 11:20' : 'Needs you · 31 min'} · <Av p="claude" />Claude</span>} right={<button className="m-ib" aria-label="More"><Icon n="more" s={16} /></button>} />
    {st === 'thread' ? <button className="m-nowline" onClick={run(() => phoneGo('request', 'r-vol'))}><span className="m-sunbadge" aria-hidden="true" /><span><b>Needs you.</b> Claude asks to remove a volume.</span><span className="m-nowa">Review<Icon n="right" s={12} /></span></button> : null}
    <div className="m-body m-conv">{st === 'loading' ? <div className="m-skel-conv" role="status" aria-label="Loading the conversation"><i className="u" /><i /><i /><i className="s" /></div> : <>
      <div className="m-you">{finished ? 'Add a CSV export to the statements page. Same columns as the PDF.' : working ? 'Charges are created twice when the app retries. Make POST /charges idempotent.' : 'Test our Pix webhook handler against the PSP sandbox, using the fixtures volume.'}</div>
      <button className="m-steps-sum"><Icon n="check" s={12} />{finished ? '6 steps · edited 3 files, ran 2 commands' : '4 steps · read 3 things, ran 1 command'}<Icon n="right" s={12} /></button>
      {working ? <><div className="m-agent"><Av p="claude" /><div>The parallel test caught a race: both retries read "no key yet" before either inserted it. I now lock the key row with <code>SELECT … FOR UPDATE</code>. Running the suite again.</div></div>
        <div className="m-plan"><b>Plan · 2 of 3</b><span className="done">Store each key with a hash of the body</span><span className="now">Lock the key row in the transaction</span><span>Run the charges suite</span></div>
        <div className="m-running"><span className="m-spin" aria-hidden="true" />Running <code>npm test -- charges</code> · 1:12</div></>
        : finished ? <div className="m-agent"><Av p="claude" /><div>Done. The export uses the same columns as the PDF and streams, so 50k rows don't block the page. Pull request <b>#318</b> is ready for review.<pre className="m-codeb"><span className="g">✓</span> 26 passed · statements/export.test.ts<button className="m-copy" aria-label="Copy">Copy</button></pre></div></div>
          : <><div className="m-agent"><Av p="claude" /><div>The sandbox replays old webhooks from the fixtures volume, so every test counts them twice. I want to remove the volume and start clean.</div></div>
            {p.answered === 'r-vol' ? <div className="m-done-line"><Icon n="check" s={12} />You denied removing the volume · 14:45</div> : <div className="m-gate"><span className="m-ch"><RiskChip r="critical" /><span className="m-time">31 min</span></span><b>Remove the pix-mock-data volume</b><span className="m-sub">Local Docker · can't be undone</span><div className="m-gate-a"><Btn kind="sec" full={false} onClick={() => { p.req = 'r-vol'; p.bioAct = 'deny'; p.bio = 'ask' }}>Deny</Btn><Btn full={false} onClick={() => phoneGo('request', 'r-vol')}>Review</Btn></div></div>}</>}
      {p.steers.map((m, i) => <div key={i} className="m-you steer"><span className="m-steer-tag">Steer · read after the current step</span>{m}</div>)}
    </>}</div>
    <form className="m-composer" onSubmit={e => { e.preventDefault(); const t = p.draft.trim(); if (!t) return; if (working) p.steers.push(t); p.draft = ''; syncScreen(); emit() }}>
      {working ? <button type="button" className="m-stop" aria-label="Stop the agent" title="Stop the agent"><Icon n="stop" s={12} /></button> : null}
      <input aria-label={working ? 'Steer the agent' : 'Message the agent'} placeholder={working ? 'Steer: read after the current step' : 'Message the agent'} value={p.draft} onChange={e => { p.draft = e.target.value; emit() }} enterKeyHint="send" />
      <button type="submit" className="m-send" aria-label={working ? 'Send the steer' : 'Send'} disabled={!p.draft.trim()}><Icon n="send" s={16} /></button></form>
    {p.bio === 'ask' ? <Biometric /> : null}</div>
}

/* ------------------------------------------------------------------ M5 approvals and questions */
/** A 2 s timer, then a tap, then the biometric. Not a press-and-hold (MOB-1-6). */
function CriticalDelayAllow ({ critical, onDone }: { critical: boolean; onDone: () => void }) {
  const p = P(); const ref = useRef<number>(0)
  useEffect(() => { if (!critical) { p.hold = 100; return } if (p.hold >= 100) return; const t0 = Date.now() - p.hold * 20; ref.current = window.setInterval(() => { p.hold = Math.min(100, (Date.now() - t0) / 20); emit(); if (p.hold >= 100) clearInterval(ref.current) }, 60); return () => clearInterval(ref.current) }, [critical, p.req])
  const ready = p.hold >= 100
  return <button className={'m-btn sec full m-allow' + (ready ? '' : ' wait')} disabled={!ready} onClick={run(onDone)} style={{ ['--p' as string]: p.hold + '%' }}>{ready ? <Icon n="fingerprint" s={16} /> : <span className="m-ring" aria-hidden="true" />}<span>{ready ? 'Allow once' : `Allow once in ${Math.max(1, Math.ceil((100 - p.hold) / 50))} s`}</span></button>
}
/** Every answer (Allow, Deny, Send) goes through here; Cancel sends nothing (MOB-1-1). */
function Biometric () {
  const p = P(); const r = REQUESTS.find(x => x.id === p.req)
  const what = p.bioAct === 'send' ? 'Send your answers to the agent' : `${p.bioAct === 'deny' ? 'Deny' : 'Allow once'}: ${r?.title}`
  return <div className="m-sheet-scrim"><section className="m-sheet" role="dialog" aria-label="Confirm it's you"><span className="m-fp-big" aria-hidden="true"><Icon n="fingerprint" s={16} /></span><h2 className="m-h2">Confirm it's you</h2><p className="m-text">{what}. Use your fingerprint or screen lock.</p>
    <div className="m-sheet-a"><Btn kind="ghost" full={false} onClick={() => { p.bio = '' }}>Cancel</Btn><Btn full={false} onClick={() => { p.bio = 'ok'; p.answered = p.req; p.answeredHow = p.bioAct }}>Simulate: confirmed</Btn></div><p className="m-fine">Cancel sends nothing; the request keeps waiting.</p></section></div>
}
function Request () {
  const p = P(); const st = p.st
  if (st === 'gone') return <div className="m-scr"><AppBar back={() => phoneGo('live', 'needs')} title="Request" /><div className="m-body"><div className="m-empty"><span className="m-ei ok"><Icon n="check" s={16} /></span><h2 className="m-h2">No longer waiting</h2><p className="m-text">This request was answered on {PC.name} at 14:35.</p><Btn kind="sec" full={false} onClick={() => phoneGo('live', 'needs')}>Back to what needs you</Btn></div></div></div>
  if (st === 'levels') return <div className="m-scr"><AppBar back={() => phoneGo('live', 'needs')} title="Risk levels" /><div className="m-body m-pad m-stack"><p className="m-text">Every request your agents send carries one of four levels, the same as on the computer.</p>{(['low', 'medium', 'high', 'critical'] as Risk[]).map(r => <div key={r} className="m-lvl"><RiskChip r={r} /><span>{RISK[r][1]}{r === 'critical' ? '. Allow unlocks after 2 s, then your fingerprint or screen lock.' : ''}</span></div>)}<Notice intent="info" icon="monitor" title="Some requests are answered on the computer">The computer marks which ones. They show here so you know, but the answer happens there.</Notice><Notice intent="info" icon="fingerprint" title="Every answer asks for your fingerprint or screen lock">Allow, Deny and sending answers alike.</Notice></div></div>
  const r = REQUESTS.find(x => x.id === p.req)!; const t = THREADS.find(x => x.id === r.thread)!
  if (p.answered === r.id) return <div className="m-scr"><AppBar back={() => phoneGo('live', 'needs')} title="Request" /><div className="m-body"><div className="m-empty"><span className="m-ei ok"><Icon n="check" s={16} /></span><h2 className="m-h2">{p.answeredHow === 'deny' ? 'Denied' : r.kind === 'question' ? 'Answers sent' : 'Allowed once'}</h2><p className="m-text">{p.answeredHow === 'deny' ? `${t.prov === 'claude' ? 'Claude' : 'Codex'} is told no and takes another way.` : `${t.prov === 'claude' ? 'Claude' : 'Codex'} continues on ${PC.name}.`}</p><Btn kind="sec" full={false} onClick={() => phoneGo('live', 'needs')}>Back to what needs you</Btn></div></div></div>
  if (r.truncated && r.kind === 'question') return <div className="m-scr"><AppBar back={() => phoneGo('live', 'needs')} title="The agent's question" sub={<span className="m-rs"><Av p={t.prov} />{t.title}</span>} />
    <div className="m-body m-pad m-stack"><Notice intent="info" icon="monitor" title={`Answer on ${PC.name}`}>Part of this question didn't fit on the phone. Answer it on your computer, where you can read all of it.</Notice></div>
    <div className="m-act"><Btn kind="sec" onClick={() => phoneGo('thread', 'thread')}>Open the conversation</Btn></div></div>
  if (r.kind === 'question') { const q = QUESTIONS[p.qi]; const sel = p.qa[p.qi] || []; const all = QUESTIONS.every((_, i) => (p.qa[i] || []).length)
    return <div className="m-scr"><AppBar back={() => phoneGo('live', 'needs')} title="The agent's questions" sub={<span className="m-rs"><Av p={t.prov} />{t.title}</span>} />
      <div className="m-body m-pad m-stack"><div className="m-pager"><span>Question {p.qi + 1} of {QUESTIONS.length}</span><span className="m-dots">{QUESTIONS.map((_, i) => <i key={i} className={i === p.qi ? 'on' : (p.qa[i] || []).length ? 'done' : ''} />)}</span></div>
        <div className="m-unchecked"><span>Written by the agent · OXESpace hasn't checked this text</span><b>{q.q}</b></div>
        <div role={q.multi ? 'group' : 'radiogroup'} className="m-opts">{q.opts.map(([l, d]) => { const on = sel.includes(l); return <button key={l} role={q.multi ? 'checkbox' : 'radio'} aria-checked={on} className={'m-opt' + (on ? ' on' : '')} onClick={run(() => { p.qa[p.qi] = q.multi ? (on ? sel.filter(x => x !== l) : [...sel, l]) : [l] })}><span className={'m-box' + (q.multi ? ' sq' : '')}>{on ? <Icon n="check" s={12} /> : null}</span><span><b>{l}</b>{d}</span></button> })}</div></div>
      <div className="m-act">{p.qi < QUESTIONS.length - 1 ? <Btn disabled={!sel.length} onClick={() => { p.qi++ }}>Next question</Btn> : <Btn icon="fingerprint" disabled={!all} onClick={() => { p.bioAct = 'send'; p.bio = 'ask' }}>Send answers</Btn>}<p className="m-fine"><Icon n="fingerprint" s={12} />Every answer asks for your fingerprint or screen lock.</p></div>
      {p.bio === 'ask' ? <Biometric /> : null}</div> }
  const crit = r.risk === 'critical'
  return <div className="m-scr"><AppBar back={() => phoneGo('live', 'needs')} title="Request" sub={<span className="m-rs"><Av p={t.prov} />{t.title}</span>} />
    <div className="m-body m-pad m-stack">
      {!r.answerable ? <Notice intent="info" icon="monitor" title={`Answer on ${PC.name}`}>{PC.name} answers this one. You can read everything here.</Notice> : null}
      {r.truncated ? <Notice intent="warning" icon="warn" title="Only part of this request reached the phone">Part of this request didn't fit on the phone. The full text is only on your computer, so from here you can only decline it.</Notice> : null}
      <div className="m-ch"><RiskChip r={r.risk!} /><span className="m-sub">{RISK[r.risk!][1]}</span></div>
      <h2 className="m-h2 big">{r.title}</h2>
      <div className="m-facts"><div><span>Requested by</span><b className="m-trunc">{t.title}</b></div><div><span>Where</span><b>{r.where}</b></div><div><span>Tool</span><b>{r.tool}</b></div></div>
      <div className="m-cmd"><pre>{r.hidden ? <>rm -rf ~/<mark className="m-hidden" title="Hidden character U+202E">U+202E</mark>txt.sh</> : r.cmd}{r.truncated ? <span className="m-cutmark">cut here · the rest is on the computer</span> : null}</pre>{r.truncated ? null : <button className="m-copy">Copy</button>}</div>
      {r.hidden ? <Notice intent="warning" icon="eye" title="This command has a hidden character">U+202E reverses how the rest of the line is displayed. It is shown here as a marker, never rendered.</Notice> : null}
      {r.notes?.length ? <ul className="m-notes">{r.notes.map(n => <li key={n}><Icon n="warn" s={12} />{n}</li>)}</ul> : null}
      {r.why ? <div className="m-unchecked"><span>Written by the agent · OXESpace hasn't checked this text</span><b>Why</b>{r.why}</div> : null}
      {r.answerable ? <input className="m-input" aria-label="Reason for the agent (optional)" placeholder="Reason for the agent (optional)" /> : null}
    </div>
    {r.answerable ? <div className="m-act"><Btn onClick={() => { p.bioAct = 'deny'; p.bio = 'ask' }}>Deny</Btn>{r.truncated ? null : <CriticalDelayAllow critical={crit} onDone={() => { p.bioAct = 'allow'; p.bio = 'ask' }} />}<p className="m-fine"><Icon n="fingerprint" s={12} />Every answer asks for your fingerprint or screen lock.{crit && !r.truncated ? ' Critical: Allow unlocks after 2 s.' : ''}</p></div>
      : <div className="m-act"><Btn kind="sec" onClick={() => phoneGo('thread', 'thread')}>Open the conversation</Btn></div>}
    {p.bio === 'ask' ? <Biometric /> : null}</div>
}

/* ------------------------------------------------------------------ M6 terminal (a VT screen, T97/T98) */
const RO_ROWS: [string, string][][] = [
  [['╭─ Codex ', 'm'], ['GPT-5 Codex', 'w'], [' · ~/cajui-api/t143 ─────────────────────────────╮', 'm']],
  [['│ ', 'm'], ['› Find why the monthly invoice report takes 40 s', 'w']],
  [['│ ', 'm'], ['✓ ', 'g'], ['Read src/reports/invoice.ts, src/db/queries.ts', '']],
  [['│ ', 'm'], ['✓ ', 'g'], ['EXPLAIN ANALYZE … invoice_items  ', ''], ['38.2 s · seq scan', 'y']],
  [['│ ', 'm'], ['✓ ', 'g'], ['Created migrations/0043_invoice_items_invoice_id.sql', '']],
  [['│ ', 'm'], ['! ', 'y'], ['Wants to run an UPDATE on billing-staging (1,284 rows)', 'y']],
  [['│ ', 'm'], ['  Answer on the computer: database writes are answered there.', 'm']],
  [['╰──────────────────────────────────────────────────────────────────────────╯', 'm']]
]
/** #658: a Claude Code pane's own session, read only, beside its screen (ACs M6.11–M6.14). */
const CC_ROWS: [string, string][][] = [
  [['╭─ ', 'm'], ['Claude Code', 'w'], [' ─────────────────────────────────────────────────────────────╮', 'm']],
  [['│ ', 'm'], ['> Use Redis for the limit; we run 3 instances.', 'w']],
  [['│ ', 'm'], ['● ', 'g'], ['Update(src/middleware/rateLimit.ts)', '']],
  [['│ ', 'm'], ['  ⎿ ', 'm'], ['Updated with 18 additions and 9 removals', 'm']],
  [['│ ', 'm'], ['● ', 'g'], ['Bash(npm test -- rate-limit)', '']],
  [['│ ', 'm'], ['  ⎿ ', 'm'], ['Running… ', 'y'], ['(0:41)', 'm']],
  [['│ ', 'm'], ['✻ Thinking… ', 'y'], ['esc to interrupt', 'm']],
  [['╰──────────────────────────────────────────────────────────────────────────╯', 'm']],
  [['  > ', 'm']]
]
function TermConversation () {
  const p = P(); const up = p.st === 'conv-new'
  return <><div className="m-tconv" role="region" aria-label="Claude Code's conversation" tabIndex={0}><div className="m-conv">
    {up ? <button className="m-loadmore">Load earlier</button> : null}
    {up ? <><div className="m-you">Charges are created twice when the app retries. Make POST /charges idempotent.</div>
      <div className="m-agent"><Av p="claude" /><div>Done. Each key is stored with a hash of the body, and a second request with the same key gets the first answer back.</div></div></> : null}
    <div className="m-you">Add rate limiting to POST /charges: 10 a minute per API key.</div>
    <div className="m-agent"><Av p="claude" /><div>I added a token bucket in <code>middleware/rateLimit.ts</code>. Over the limit, the API answers 429 with <code>Retry-After</code>.</div></div>
    {up ? null : <><div className="m-you">Use Redis for the limit; we run 3 instances.</div>
      <div className="m-agent"><Av p="claude" /><div>The bucket now lives in Redis, updated by one atomic script, so the 3 instances share it. Running the rate-limit tests.</div></div></>}
  </div></div>
    {up ? <button className="m-latest" aria-label="3 new messages, go to latest" onClick={run(() => { p.st = 'conversation' })}>3 new · Latest<Icon n="down" s={12} /></button> : null}</>
}
function Terminal () {
  const p = P(); const st = p.st; const conv = st.startsWith('conv'); const gone = st === 'conv-gone'
  const view = conv ? p.tview : 'screen'; const typing = st === 'typing' || conv
  const rows = conv ? CC_ROWS : typing ? VT_ROWS : RO_ROWS
  const name = conv ? 'Claude Code' : typing ? 'npm run dev' : 'Codex'
  return <div className="m-scr m-term-scr"><AppBar back={() => phoneGo('live', 'terminals')} title={name} sub={<span className="m-rs"><WsChip name={conv ? 'cajui-api · t144' : typing ? 'cajui-api · t142' : 'cajui-api · t143'} />{view === 'screen' ? <span className="mono" title="From the pane's snapshot (cols × rows)">{VT_COLS}×24</span> : null}{typing ? <span className="m-type"><Icon n="keyboard" s={12} />You can type</span> : <span className="m-ro"><Icon n="eye" s={12} />Read-only</span>}</span>} right={view === 'screen' ? <button className="m-ib" aria-label={p.fit ? 'Text size: actual size' : 'Text size: fit the width'} aria-pressed={p.fit} title="Fit the width" onClick={run(() => { p.fit = !p.fit })}><Icon n="type" s={16} /></button> : undefined} />
    {conv && !gone ? <div className="m-tview"><div className="m-seg two" role="radiogroup" aria-label="View">{([['screen', 'Screen'], ['conv', 'Conversation']] as const).map(([k, l]) => <button key={k} role="radio" aria-checked={p.tview === k} onClick={run(() => { p.tview = k })}>{l}</button>)}</div>
      {view === 'conv' ? <p className="m-vcap">Claude Code's conversation · read only{st === 'conversation' ? <span className="m-live"><i aria-hidden="true" />Live</span> : null}</p> : null}</div> : null}
    {view === 'conv' && gone ? <div className="m-body m-pad"><Notice intent="info" icon="info" title="This terminal's conversation isn't available any more." actions={<Btn onClick={run(() => { p.tview = 'screen' })}>Show the screen</Btn>}>The screen is still live.</Notice></div>
      : view === 'conv' ? <TermConversation />
      : <div className={'m-vt' + (p.fit ? ' fit' : '')}>{st === 'loading' ? <div className="m-vt-load"><span className="m-spin" aria-hidden="true" />Connecting to the pane…</div> : <>
      <div className="m-vt-note"><Icon n="eye" s={12} />1 secret value hidden by your computer</div>
      <div className="m-vt-pan" role="region" aria-label={`Terminal screen, ${VT_COLS} columns by 24 rows. Swipe sideways to pan.`} tabIndex={0}><div className="m-vt-grid" style={{ ['--cols' as string]: VT_COLS }}>{rows.map((row, i) => <div key={i} className="m-vt-row">{row.map(([s, c], j) => <span key={j} className={'v-' + c}>{s}</span>)}{st === 'typing' && i === rows.length - 1 ? <><span className="v-g">marina@desktop</span>:<span className="v-b">~/cajui-api/t142</span>$ {p.termDraft}<span className="m-cursor" /></> : null}</div>)}</div></div>
      {p.fit ? null : <div className="m-vt-more" aria-hidden="true"><Icon n="right" s={12} />{VT_COLS} cols · swipe to pan</div>}</>}</div>}
    {view === 'conv' && !gone ? <button className="m-typehint" onClick={run(() => { p.tview = 'screen' })}><Icon n="keyboard" s={16} /><span>Type on the Screen view</span><Icon n="right" s={12} /></button>
      : view === 'conv' ? null
      : typing ? <div className="m-keys-wrap"><div className="m-keyrow"><div className="m-keys" id="m-keys" role="toolbar" aria-label="Terminal keys">{['Esc', 'Tab', '⇧Tab', 'Ctrl', 'Ctrl C', '↑', '↓', '←', '→', '|', '~', '/'].map(k => <button key={k} className="m-key">{k}</button>)}</div><button className="m-keymore" aria-label="More keys" aria-controls="m-keys" title="More keys" onClick={e => { const row = (e.currentTarget.previousElementSibling as HTMLElement); row.scrollBy({ left: row.scrollLeft + row.clientWidth >= row.scrollWidth - 4 ? -row.scrollWidth : 160, behavior: 'smooth' }) }}><Icon n="right" s={16} /></button></div>
      <div className="m-tin"><span className="mono">$</span><input className="mono" aria-label="Type in this terminal" placeholder="Type here; Enter sends" value={p.termDraft} onChange={e => { p.termDraft = e.target.value; emit() }} /><button className="m-send" aria-label="Send to the terminal" disabled={!p.termDraft}><Icon n="send" s={16} /></button></div></div>
      : st === 'read-only' ? <div className="m-vt-foot"><Icon n="lock" s={12} />{PC.name} doesn't let this phone type here. Turn it on in the pane's menu on the computer.</div> : null}</div>
}

/* ------------------------------------------------------------------ M8 settings */
function Settings () {
  const p = P()
  const Row = ({ icon, title, sub, right }: { icon: string; title: string; sub?: string; right?: ReactNode }) => <div className="m-srow"><span className="m-sri"><Icon n={icon} s={16} /></span><span className="m-rm"><b>{title}</b>{sub ? <span className="m-sub">{sub}</span> : null}</span>{right}</div>
  const Sw = ({ k }: { k: string }) => <button role="switch" aria-checked={!!p.notif[k]} className="m-switch" aria-label={k} onClick={run(() => { p.notif[k] = !p.notif[k] })}><i /></button>
  return <div className="m-scr"><AppBar back={() => phoneGo('live', 'threads')} title="Settings" />
    <div className="m-body m-pad m-stack">
      <section className="m-pccard big"><span className="m-pci"><Icon n="monitor" s={16} /></span><div><b>{PC.name}</b><span>{PC.os} · paired {PC.since} · connected now</span></div></section>
      <Btn kind="danger" onClick={() => { p.unpairAsk = true }}>Unpair this phone</Btn>
      <section className="m-sgroup"><h2>Answers</h2><Row icon="fingerprint" title="Fingerprint or screen lock" sub="Asked on every answer. This is a safety rule and can't be turned off." right={<span className="m-lockpill"><Icon n="lock" s={12} />Always</span>} /><Row icon="warn" title="Critical requests" sub="Allow unlocks after 2 s." /><Row icon="monitor" title="Answered on the computer" sub="Database writes and desktop-only requests." /></section>
      <section className="m-sgroup"><h2>Notifications</h2><Row icon="bell" title="Something needs you" right={<Sw k="needs" />} /><Row icon="check" title="A conversation finished" right={<Sw k="done" />} /><Row icon="warn" title="Something failed" right={<Sw k="failed" />} /></section>
      <section className="m-sgroup"><h2>Appearance</h2><div className="m-seg" role="radiogroup" aria-label="Theme">{[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => <button key={k} role="radio" aria-checked={p.appearance === k} onClick={run(() => { p.appearance = k })}>{l}</button>)}</div></section>
      <section className="m-sgroup"><h2>Typing in terminals</h2><Row icon="keyboard" title="1 terminal accepts typing from this phone" sub={`${PC.name} decides, per terminal, in the pane's menu.`} /></section>
      <section className="m-sgroup"><h2>Can't connect?</h2><Row icon="wifi" title="Enter the computer's address" sub={`If ${PC.name} changed networks or its address, type the address shown in its Settings › Devices.`} right={<Icon n="right" s={12} />} /></section>
      <section className="m-sgroup"><h2>About</h2><Row icon="info" title="OXESpace for Android 1.5.0" sub="Open-source licences" right={<Icon n="right" s={12} />} /></section>
    </div>
    {p.unpairAsk ? <div className="m-sheet-scrim"><section className="m-sheet" role="dialog" aria-label="Unpair this phone?"><h2 className="m-h2">Unpair this phone?</h2><p className="m-text">{PC.name} forgets this phone. To use it again, you scan a new code on the computer.</p>
      <div className="m-sheet-a"><Btn kind="ghost" full={false} onClick={() => { p.unpairAsk = false }}>Cancel</Btn><Btn kind="danger" full={false} onClick={() => phoneGo('home', 'unpaired')}>Unpair</Btn></div></section></div> : null}</div>
}

/* ------------------------------------------------------------------ the frame and the stage */
function Device ({ mode }: { mode: 'light' | 'dark' }) {
  const scr = P().scr
  return <div className="m-device"><div className="app phone" data-mode={mode}>
    <div className={'m-status' + (scr === 'terminal' ? ' term' : '')} aria-hidden="true"><span>14:44</span><span className="sp" /><Icon n="signal" s={12} /><Icon n="wifi" s={12} /><Icon n="battery" s={12} /></div>
    {scr === 'home' ? <Home /> : scr === 'pair' ? <Pair /> : scr === 'live' ? <Live /> : scr === 'thread' ? <Thread /> : scr === 'request' ? <Request /> : scr === 'terminal' ? <Terminal /> : <Settings />}
    <div className="m-gesture" aria-hidden="true"><i /></div></div><div className="m-cap">{mode}</div></div>
}
export function PhoneStage () {
  const p = P(); const states = PHONE_STATES[p.scr] || []
  return <div className="m-stage">
    <div className="m-states" role="tablist" aria-label="States of this screen">{states.map(([k, l]) => <button key={k} role="tab" aria-selected={p.st === k} onClick={run(() => phoneGo(p.scr, k))}>{l}</button>)}
      <span className="sp" /><div className="seg" role="group" aria-label="Themes"><button aria-pressed={p.themes === 'both'} onClick={run(() => { p.themes = 'both' })}>Light + dark</button><button aria-pressed={p.themes === 'one'} onClick={run(() => { p.themes = 'one' })}>Theme bar</button></div></div>
    <div className="m-devices">{(p.themes === 'both' ? ['light', 'dark'] as const : [S.mode]).map(m => <Device key={m} mode={m} />)}</div></div>
}
