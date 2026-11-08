/* 1.5.0 cockpit: see what agents build, live. The agent browser (with real device emulation), the Android mirror,
   the agents' HTTP calls, the containers panel and a pane's conversation. Copy stays short: one line of help at most. */
import type { ReactNode } from 'react'
import { D } from '../mock/data'
import { S, emit, run, task, toast } from '../state/store'
import { Icon, Av, MI, menuBtn, StateBlock } from './ui'
import { MENUS } from './Shell'
import { TermView } from './Tools'
import { syncScreen } from '../screens/registry'

/* ================================================================ agent browser (B1) + device emulation (B2) */
export const DEVICES: [string, string, number, number][] = [['desktop', 'Desktop', 0, 0], ['pixel8', 'Pixel 8', 412, 915], ['iphone15', 'iPhone 15', 393, 852], ['s23', 'Galaxy S23', 360, 780], ['ipad', 'iPad mini', 744, 1133]]
const STEPS: [string, string][] = [['globe', 'Opened /statements'], ['pencil', 'Month: March'], ['check', 'Clicked Download CSV']]
const CONSOLE: [string, string, string][] = [['err', 'GET /api/statements?month=03 → 500', 'fetch'], ['warn', 'Each child in a list needs a key', 'StatementsTable.tsx:41'], ['info', 'CSV ready: 52 rows', 'export.ts:18']]
const NETWORK: [string, string, number, string, string][] = [['GET', '/statements', 200, 'document', '38 ms'], ['GET', '/assets/app.js', 200, 'script', '12 ms'], ['GET', '/api/statements?month=03', 500, 'fetch', '212 ms'], ['GET', '/api/statements?month=03', 200, 'fetch', '96 ms'], ['GET', '/api/statements/export.csv', 200, 'fetch', '140 ms']]
const local = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(u)

function Site ({ narrow, act }: { narrow?: boolean; act: boolean }) {
  const rows = [['03/04', 'Pix · Padaria Boa Vista', '1.240,00'], ['03/04', 'Pix · Ótica Central', '389,90'], ['03/05', 'Refund · Studio Pilates Lis', '-210,00'], ['03/05', 'Pix · Mercadinho São José', '76,40']]
  return <div className={'site' + (narrow ? ' narrow' : '')}><div className="site-h"><b>Cajuí</b>{narrow ? <span className="sp" /> : <><span>Statements</span><span>Charges</span><span>Refunds</span><span className="sp" /></>}<span className="av-s">MS</span></div>
    <div className="site-b"><div className="row"><h3>Statements · March</h3><span className="sp" /><span className={'site-btn' + (act ? ' hl' : '')} data-agent={act ? 'Claude · click' : undefined}>Download CSV</span></div>
      {narrow ? <div className="site-cards">{rows.map(r => <div key={r[1]}><span>{r[1]}</span><b>R$ {r[2]}</b><small>{r[0]}</small></div>)}</div>
        : <table><thead><tr><th>Date</th><th>Description</th><th className="r">Amount</th></tr></thead><tbody>{rows.map(r => <tr key={r[1]}><td>{r[0]}</td><td>{r[1]}</td><td className="r">R$ {r[2]}</td></tr>)}</tbody></table>}</div></div>
}
export function AgentBrowser () {
  const b = S.br; const url = S.wbUrl ?? 'http://localhost:3002/statements'
  const dev = DEVICES.find(d => d[0] === b.dev) || DEVICES[0]
  const bar = <div className="bbar"><button className="ibtn sm" aria-label="Back"><Icon n="left" s={12} /></button><button className="ibtn sm" aria-label="Reload" onClick={run(() => toast('Reloaded'))}><Icon n="refresh" s={12} /></button>
    <input className="input mono" value={url} aria-label="Address" onChange={e => { S.wbUrl = e.target.value; emit() }} />
    <button className="btn sm" onClick={menuBtn('brdev')} aria-haspopup="menu" aria-label={`Device: ${dev[1]}`}><Icon n={dev[2] ? 'phone' : 'monitor'} s={12} />{dev[1]}<Icon n="down" s={12} /></button>
    {dev[2] ? <button className="ibtn sm" aria-label="Rotate" title="Rotate" aria-pressed={b.rot} onClick={run(() => { b.rot = !b.rot })}><Icon n="refresh" s={12} /></button> : null}
    <button className="ibtn sm" aria-label="Grab an element for the agent" title="Grab for the agent" onClick={run(() => toast('Pick an element to send it to the agent'))}><Icon n="sparkle" s={12} /></button>
    <button className="ibtn sm" aria-label="Open in your browser" title="Open in your browser" onClick={run(() => toast('Opened in your browser'))}><Icon n="ext" s={12} /></button></div>
  if (S.view === 'loading') return <div className="abr">{bar}<StateBlock kind="loading" /></div>
  if (S.view === 'error') return <div className="abr">{bar}<StateBlock kind="error" title="localhost:3002 isn't answering" text="Start the dev server, then reload."><button className="btn" onClick={run(() => { S.view = 'live'; toast('npm run dev started in a terminal') })}><Icon n="play" s={12} />Run npm run dev</button></StateBlock></div>
  if (S.view === 'empty') return <div className="abr">{bar}<StateBlock kind="empty" icon="globe" title="No page open" text="Type an address, or run your dev server."><button className="btn pri" onClick={run(() => { S.view = 'live' })}>Open localhost:3002</button></StateBlock></div>
  const [w, h] = b.rot ? [dev[3], dev[2]] : [dev[2], dev[3]]
  const sc = dev[2] ? Math.min((S.w === 900 ? 300 : 470) / h, (S.w === 900 ? 260 : 400) / w) : 1
  const errs = CONSOLE.filter(c => c[0] === 'err').length
  return <div className="abr">{bar}
    {b.agent ? <div className="abr-who" role="status"><Av p="claude" size="s16" /><span className="trunc"><b>Claude</b> is using this page</span><span className={'pill ' + (local(url) ? 'neutral' : 'needs')} style={{ height: 18 }} title={local(url) ? 'Allowed for this session on localhost' : 'Each action asks you first'}>{local(url) ? 'This session' : 'Asks each time'}</span><span className="sp" /><button className="btn sm" onClick={run(() => { b.agent = false; toast('Claude can no longer use this page') })}>End</button></div> : null}
    <div className={'abr-view' + (dev[2] ? ' dev' : '')}>{dev[2] ? <div className="devf" style={{ width: w * sc + 20, height: h * sc + 20 }} aria-label={`${dev[1]}, ${w} × ${h}`}><div className="devs" style={{ width: w, height: h, transform: `scale(${sc})` }}><Site narrow={w < 600} act={b.agent} /></div></div> : <Site act={b.agent} />}</div>
    <div className="abr-foot">{b.agent ? <ol className="abr-steps" aria-label="What the agent did">{STEPS.map(([ic, l], i) => <li key={l} className={i === STEPS.length - 1 ? 'now' : ''}><Icon n={ic} s={12} />{l}</li>)}</ol> : <span className="muted trunc">{dev[2] ? `${dev[1]} · ${w} × ${h}` : 'Desktop'}</span>}<span className="sp" />
      <button className="chip dbtn" aria-pressed={b.drawer === 'console'} onClick={run(() => { b.drawer = b.drawer === 'console' ? '' : 'console' })}>Console{errs ? <span className="n dz">{errs}</span> : null}</button>
      <button className="chip dbtn" aria-pressed={b.drawer === 'network'} onClick={run(() => { b.drawer = b.drawer === 'network' ? '' : 'network' })}>Network</button></div>
    {b.drawer ? <div className="abr-drawer" role="region" aria-label={b.drawer === 'console' ? 'Console' : 'Network'}>{b.drawer === 'console'
      ? CONSOLE.map(([lv, m, src], i) => <div key={i} className={'cline ' + lv}><Icon n={lv === 'err' ? 'warn' : lv === 'warn' ? 'warn' : 'info'} s={12} /><span className="mono trunc">{m}</span><span className="muted mono">{src}</span></div>)
      : <table className="ctable"><tbody>{NETWORK.map((r, i) => <tr key={i}><td><span className={'meth ' + r[0]}>{r[0]}</span></td><td className="mono trunc" style={{ maxWidth: 260 }}>{r[1]}</td><td><span className={'st s' + String(r[2])[0]}>{r[2]}</span></td><td className="muted">{r[3]}</td><td className="mono r">{r[4]}</td></tr>)}</tbody></table>}</div> : null}</div>
}
MENUS.brdev = () => <><div className="mg">Device</div>{DEVICES.map(([id, l, w, h]) => <MI key={id} check={S.br.dev === id} label={l} hint={w ? `${w} × ${h} · touch` : 'Full width'} onClick={() => { S.br.dev = id; S.br.rot = false; syncScreen() }} />)}</>

/* ================================================================ Android mirror (B3) */
const ADEV: [string, string, string][] = [['emu', 'Pixel 8', 'Emulator · API 36'], ['s23', 'Galaxy S23', 'USB']]
export function AndroidPanel () {
  const a = S.and; const d = ADEV.find(x => x[0] === a.dev) || ADEV[0]
  if (S.view === 'loading') return <StateBlock kind="loading" title={`Connecting to ${d[1]}…`} />
  if (S.view === 'error') return <StateBlock kind="error" title={`Lost ${d[1]}`} text="The cable was unplugged or USB debugging turned off."><button className="btn" onClick={run(() => { S.view = 'live'; toast(`Reconnected to ${d[1]}`) })}><Icon n="refresh" s={12} />Reconnect</button></StateBlock>
  if (S.view === 'empty') return <StateBlock kind="empty" icon="phone" title="No Android device" text="Start an emulator, or plug in a phone with USB debugging on."><button className="btn pri" onClick={run(() => { S.view = 'live'; a.dev = 'emu'; toast('Started the Pixel 8 emulator') })}>Start the Pixel 8 emulator</button></StateBlock>
  const [w, h] = a.rot ? [780, 360] : [360, 780]
  const sc = Math.min((S.w === 900 ? 330 : 520) / h, (S.w === 900 ? 260 : 380) / w)
  return <div className="andr"><div className="bbar"><button className="btn sm" onClick={menuBtn('adev')} aria-haspopup="menu"><Icon n="phone" s={12} />{d[1]}<span className="muted">{d[2]}</span><Icon n="down" s={12} /></button><span className="live-dot" role="status"><i />Live</span><span className="sp" />
    <button className="ibtn sm" aria-label="Rotate" title="Rotate" aria-pressed={a.rot} onClick={run(() => { a.rot = !a.rot })}><Icon n="refresh" s={12} /></button>
    <button className="ibtn sm" aria-label="Save a screenshot" title="Screenshot" onClick={run(() => toast('Saved screenshot-14-42.png'))}><Icon n="download" s={12} /></button>
    <label className="andr-see"><button className="tg-sw" role="switch" aria-checked={a.see} aria-label="Agents can see this screen" onClick={run(() => { a.see = !a.see; toast(a.see ? 'Agents can take screenshots of this device' : 'Agents can no longer see this device') })} />Agents can see</label></div>
    <div className="andr-view"><div className="devf phone" style={{ width: w * sc + 20, height: h * sc + 20 }} aria-label={`${d[1]} screen, live`}><div className="devs" style={{ width: w, height: h, transform: `scale(${sc})` }} onClick={() => toast('Tapped on the device')}>
      <div className="app-m"><div className="app-st"><span>14:42</span><span className="sp" /><span>5G · 82%</span></div><div className="app-h"><b>Cajuí</b><span className="av-s">MS</span></div>
        <div className="app-bal"><small>Balance</small><b>R$ 12.480,32</b><span>+ R$ 1.629,90 today</span></div>
        <div className="app-l">{[['Pix · Padaria Boa Vista', '1.240,00'], ['Pix · Ótica Central', '389,90'], ['Refund · Studio Pilates', '-210,00'], ['Pix · Mercadinho São José', '76,40']].map(([n, v]) => <div key={n}><span>{n}</span><b>R$ {v}</b></div>)}</div>
        <div className="app-nav"><span>Home</span><span>Pix</span><span>Statements</span></div><div className="app-gest" /></div></div></div></div></div>
}
MENUS.adev = () => <><div className="mg">Devices</div>{ADEV.map(([id, n, k]) => <MI key={id} check={S.and.dev === id} label={n} hint={k} onClick={() => { S.and.dev = id }} />)}<hr /><MI icon="play" label="Start an emulator…" onClick={() => toast('Pick an emulator from Android Studio\'s list')} /></>

/* ================================================================ agents' HTTP calls (H1/H2) */
interface Call { id: string; t: string; by: string; m: string; host: string; path: string; st: number | null; at: string; ms: number; cmd: string; hdr: string[]; body?: string; prod?: boolean; insecure?: boolean }
export const CALLS: Call[] = [
  { id: 'h1', t: 't142', by: 'claude', m: 'POST', host: 'localhost:3002', path: '/v1/charges', st: 201, at: '14:40', ms: 84, cmd: 'curl -s -X POST localhost:3002/v1/charges -H "Idempotency-Key: ••••" -d @charge.json', hdr: ['Content-Type', 'Idempotency-Key'], body: 'JSON · 214 B' },
  { id: 'h2', t: 't142', by: 'claude', m: 'POST', host: 'localhost:3002', path: '/v1/charges', st: 201, at: '14:40', ms: 31, cmd: 'curl -s -X POST localhost:3002/v1/charges -H "Idempotency-Key: ••••" -d @charge.json', hdr: ['Content-Type', 'Idempotency-Key'], body: 'JSON · 214 B' },
  { id: 'h3', t: 't142', by: 'claude', m: 'GET', host: 'localhost:3002', path: '/v1/charges/:id', st: 200, at: '14:41', ms: 12, cmd: 'curl -s localhost:3002/v1/charges/ch_1Qa9', hdr: [] },
  { id: 'h4', t: 't144', by: 'codex', m: 'POST', host: 'pix.sandbox.cajui.dev', path: '/webhooks/test', st: 202, at: '14:22', ms: 340, cmd: 'http POST pix.sandbox.cajui.dev/webhooks/test Authorization:"Bearer ••••" txid=E2E9', hdr: ['Authorization'], body: 'JSON · 58 B' },
  { id: 'h5', t: 't144', by: 'codex', m: 'GET', host: 'pix.sandbox.cajui.dev', path: '/cob/:id', st: 404, at: '14:23', ms: 120, cmd: 'curl -s -i pix.sandbox.cajui.dev/cob/E2E9 -H "Authorization: Bearer ••••"', hdr: ['Authorization'] },
  { id: 'h6', t: 't147', by: 'claude', m: 'GET', host: 'api.cajui.com.br', path: '/v2/refunds', st: 200, at: '14:12', ms: 210, cmd: 'curl -s "https://api.cajui.com.br/v2/refunds?status=•••&since=•••" -H "Authorization: Bearer ••••"', hdr: ['Authorization'], prod: true },
  { id: 'h7', t: 't145', by: 'codex', m: 'GET', host: 'downloads.example.org', path: '/postgres/17/pg17.tar.gz', st: null, at: '13:58', ms: 0, cmd: 'wget http://downloads.example.org/postgres/17/pg17.tar.gz', hdr: [], insecure: true }
]
const stLabel = (s: number | null) => s == null ? 'No status' : String(s)
export function HttpPanel ({ tid }: { tid?: string }) {
  if (S.view === 'loading') return <StateBlock kind="loading" />
  if (S.view === 'error') return <StateBlock kind="error" title="Couldn't read the HTTP log" text="The local database didn't answer. Nothing was lost." />
  const f = S.http.f; const q = (S.http.q || '').toLowerCase()
  const all = CALLS.filter(c => !tid || c.t === tid)
  const list = S.view === 'empty' ? [] : all.filter(c => (f === 'all' || (f === 'err' ? (c.st == null || c.st >= 400) : c.prod || c.insecure)) && (!q || (c.host + c.path).toLowerCase().includes(q)))
  const sel = list.find(c => c.id === S.http.sel)
  const hosts = Array.from(new Set(list.map(c => c.host)))
  return <div className={'http' + (sel ? ' sel' : '')}><div className="http-l">
    <div className="http-bar"><label className="search mside-search" style={{ margin: 0, flex: 1 }}><Icon n="search" s={12} /><input placeholder="Filter by host or path" aria-label="Filter by host or path" value={S.http.q || ''} onChange={e => { S.http.q = e.target.value; emit() }} /></label>
      <div className="segc" role="group" aria-label="Show">{([['all', 'All'], ['err', 'Errors'], ['risk', 'Flagged']] as const).map(([k, l]) => <button key={k} aria-pressed={f === k} onClick={run(() => { S.http.f = k })}>{l}</button>)}</div></div>
    {!list.length ? <StateBlock kind="empty" icon="net" title={all.length && S.view !== 'empty' ? 'Nothing matches' : 'No HTTP calls yet'} text={all.length && S.view !== 'empty' ? 'Clear the filter to see every call.' : 'curl, wget and HTTPie calls from agents show up here.'} />
      : <div className="scroll">{hosts.map(h => { const cs = list.filter(c => c.host === h); return <div key={h} className="http-g"><div className="http-gh"><b className="mono">{h}</b>{cs[0].prod ? <span className="env production">production</span> : null}<span className="muted">{cs.length}</span></div>
        {cs.map(c => <button key={c.id} className="http-r" aria-current={c.id === S.http.sel} onClick={run(() => { S.http.sel = c.id === S.http.sel ? '' : c.id })}><span className={'meth ' + c.m}>{c.m}</span><span className="mono trunc">{c.path}</span>{c.insecure ? <span className="pill err" style={{ height: 18 }}>Not encrypted</span> : null}<span className={'st s' + (c.st ? String(c.st)[0] : '0')}>{stLabel(c.st)}</span><Av p={c.by} size="s16" /><span className="m-time">{c.at}</span></button>)}</div> })}</div>}</div>
    {sel ? <aside className="http-d" aria-label="Call detail"><div className="row"><span className={'meth ' + sel.m}>{sel.m}</span><b className="mono trunc">{sel.host}{sel.path}</b><span className="sp" /><button className="ibtn sm" aria-label="Close" onClick={run(() => { S.http.sel = '' })}><Icon n="x" s={12} /></button></div>
      <div className="row muted" style={{ fontSize: 12 }}><Av p={sel.by} size="s16" /><span className="trunc">{task(sel.t)?.title}</span><span>· {sel.at}</span></div>
      <pre className="code">{sel.cmd}</pre>
      <dl className="kv"><dt>Response</dt><dd>{sel.st == null ? 'No status in the output' : `${sel.st} · ${sel.ms} ms`}</dd><dt>Headers</dt><dd>{sel.hdr.length ? sel.hdr.join(', ') : 'None'}</dd><dt>Body</dt><dd>{sel.body || 'None'}</dd></dl>
      {sel.prod ? <div className="callout warn"><Icon n="shield" /><span>A production host. Block it in What agents can do.</span></div> : sel.insecure ? <div className="callout warn"><Icon n="lock" /><span>Sent without TLS to a host outside this computer.</span></div> : null}
      <div className="row"><button className="btn sm" onClick={run(() => { S.taskId = sel.t; S.tab = 'conv'; S.area = 'task'; syncScreen() })}>Open the conversation</button>{sel.prod ? <button className="btn sm" onClick={run(() => { S.area = 'settings'; S.page = 'permissions'; syncScreen() })}>Block this host</button> : null}</div></aside> : null}</div>
}

/* ================================================================ containers panel (P1, from the OxePod mode) */
export function ContainersPanel ({ tid }: { tid?: string }) {
  if (S.view === 'loading') return <StateBlock kind="loading" />
  if (S.view === 'error') return <StateBlock kind="error" title="Docker isn't answering" text="Start Docker Desktop, then try again." />
  const cs = S.view === 'empty' ? [] : D.containers.filter(c => !tid || c.task === tid)
  if (!cs.length) return <StateBlock kind="empty" icon="box" title="No containers" text={tid ? 'This conversation didn\'t start any.' : 'Start a compose stack from a project.'} />
  const c = cs.find(x => x.id === S.pod.sel) || cs[0]
  const stacks = Array.from(new Set(cs.map(x => x.stack)))
  return <div className="cpan"><div className="scroll cpan-l">{stacks.map(s => <div key={s}><div className="tg">{s}</div>{cs.filter(x => x.stack === s).map(x => { const t = x.task ? task(x.task) : null
    return <button key={x.id} className="cpan-r" aria-current={x.id === c.id} onClick={run(() => { S.pod.sel = x.id })}><span className={'sdot ' + (x.status === 'running' ? 'on' : 'bad')} /><b className="trunc">{x.name}</b>{t ? <span className="by" title={t.title}><Av p={t.prov} size="s16" /><span className="trunc">{t.title}</span></span> : <span className="muted">You</span>}</button> })}</div>)}</div>
    <div className="cpan-d"><div className="pane-h"><span className={'sdot ' + (c.status === 'running' ? 'on' : 'bad')} /><h3>{c.name}</h3><span className="muted" style={{ fontSize: 11 }}>{c.status === 'running' ? 'Up ' + c.up : c.up}</span><span className="sp" />
      {c.status === 'running' ? <button className="btn sm" onClick={run(() => { c.status = 'exited'; c.up = 'Exited (0) just now'; toast(`Stopped ${c.name}`, { undo: () => { c.status = 'running'; c.up = 'just now'; emit() } }) })}><Icon n="stop" s={12} />Stop</button>
        : <button className="btn sm" onClick={run(() => { c.status = 'running'; c.up = 'just now'; toast(`Started ${c.name}`) })}><Icon n="play" s={12} />Start</button>}
      <button className="ibtn sm" aria-label="Restart" title="Restart" onClick={run(() => toast(`Restarted ${c.name}`))}><Icon n="refresh" s={12} /></button><button className="ibtn sm" aria-label="More container actions" onClick={menuBtn('podmore')}><Icon n="more" s={12} /></button></div>
      <TermView k={{ id: 'cl', name: '', shell: '', cwd: '', by: '', lines: (D.logs[c.id] || [c.status === 'running' ? '14:11:02  info  ready' : 'No logs.']).map(l => [/error|FATAL/.test(l) ? 'err' : /warn|DETAIL/.test(l) ? 'dim' : '', l]) }} live={c.status === 'running'} /></div></div>
}
MENUS.podmore = () => { const c = D.containers.find(x => x.id === S.pod.sel) || D.containers[0]; return <><MI icon="term" label="Open a shell" onClick={() => toast(`A shell in ${c.name} opens in OxeCode`)} /><MI icon="copy" label="Copy container ID" onClick={() => toast('Copied the container ID')} />{/postgres|mysql|mongo/i.test(c.image) ? <MI icon="db" label="Connect in OxeQuery" onClick={() => toast(`New connection to ${c.name} opens in OxeQuery`)} /> : null}<hr /><MI icon="box" dz label="Stop the whole stack…" hint={`docker compose down in ${c.stack}`} onClick={() => { S.overlay = { type: 'dlg', id: 'poddown' } }} /><MI icon="trash" dz label="Remove container…" onClick={() => { S.overlay = { type: 'dlg', id: 'podremove', c: c.id } }} /></> }

/* ================================================================ a pane's conversation (N2, the reader of #658) */
const PCONV: Record<string, [string, string][]> = {
  claude: [['you', 'Make charge creation idempotent. Retries must never create two charges.'], ['agent', 'I\'ll store each key with a hash of the body and lock the key row inside the transaction.'], ['you', 'Also cover the 24 h expiry.'], ['agent', 'Done: keys expire after 24 h. Running the charges tests.']],
  codex: [['you', 'Find why the monthly invoice report takes 40 s.'], ['agent', 'The report scans invoice_items without an index. I created migration 0043 with an index on invoice_id.'], ['agent', 'Staging has 1,284 invoices still marked open. I want to update them so it matches production; database writes are answered on this computer.']]
}
export function PaneConv ({ prov, onType }: { prov: string; onType: () => void }) {
  const items = PCONV[prov] || PCONV.claude
  return <div className="pconv"><div className="pconv-cap"><span>Read only</span><span className="live-dot"><i />Live</span></div>
    <div className="pconv-l" role="log" aria-label="Conversation, read only">{items.map(([k, txt], i) => k === 'you' ? <div key={i} className="m-you">{txt}</div> : <div key={i} className="m-ag"><Av p={prov} size="s16" /><div className="body">{txt}</div></div>)}</div>
    <button className="pconv-type" onClick={onType}><Icon n="keyboard" s={12} />Type in the terminal<Icon n="right" s={12} /></button></div>
}

/* ================================================================ smaller pieces */
/** One per mode, instead of a line at the top: opens the Activity page filtered to this mode. */
export function ActivityBadge ({ src, n, waiting }: { src: string; n: number; waiting?: boolean }) {
  if (!n) return null
  return <button className={'act-badge' + (waiting ? ' attn' : '')} onClick={run(() => { S.actSrc = src; S.area = 'settings'; S.page = 'activity'; syncScreen() })} title="Open in Agent activity">{waiting ? <span className="sun live" /> : <Icon n="activity" s={12} />}{n} agent action{n === 1 ? '' : 's'} today</button>
}
/** N3: two conversations editing the same file in the same checkout. A chip in the header, not a banner. */
export const COLLIDE: Record<string, [string, string]> = { t142: ['t147', 'src/charges/create.ts'] }
export function CollisionChip ({ tid }: { tid: string }) {
  const c = COLLIDE[tid]; if (!c || S.collideOff) return null
  const other = task(c[0]); if (!other) return null
  return <button className="collide" onClick={run(() => { S.taskId = other.id; S.tab = 'conv'; syncScreen() })} title={`"${other.title}" is also editing ${c[1]} in this checkout`}><Icon n="warn" s={12} />Also edited by {other.key === other.title ? 'another conversation' : other.key}: <span className="mono">{c[1].split('/').pop()}</span></button>
}
/** N6: the system notification, drawn where Windows shows it. */
export function OsToast () {
  if (!S.osToast) return null
  return <div className="os-toast" role="alert"><div className="row"><span className="os-ic" aria-hidden="true">O</span><b>OXESpace</b><span className="sp" /><button className="ibtn sm" aria-label="Dismiss" onClick={run(() => { S.osToast = false })}><Icon n="x" s={12} /></button></div>
    <p><b>Codex needs you</b><br />Update 1,284 rows on billing-staging</p><button className="btn sm" onClick={run(() => { S.osToast = false; S.taskId = 't143'; S.tab = 'conv'; S.area = 'task'; S.overlay = { type: 'approve', id: 'ap_sql' }; syncScreen() })}>Open</button></div>
}
/** N5: what the agent did, beyond the diff, for the pull request description. */
export function PrSummary ({ tid }: { tid: string }) {
  const t = task(tid); if (!t) return null
  const calls = CALLS.filter(c => c.t === tid); const qs = D.queries.filter(q => q.task === tid); const cs = D.containers.filter(c => c.task === tid); const fs = D.changes[tid] || []
  const rows: [string, ReactNode][] = []
  if (fs.length) rows.push(['file', <>{fs.length} files changed</>])
  if (qs.length) rows.push(['db', <>{qs.length} database statements</>])
  if (calls.length) rows.push(['net', <>{calls.length} HTTP calls{calls.some(c => c.prod) ? ', 1 to production' : ''}</>])
  if (cs.length) rows.push(['box', <>{cs.length} containers started</>])
  const nAp = Object.keys(S.resolved).length || 1
  rows.push(['shield', <>{nAp} approval{nAp === 1 ? '' : 's'} by you</>])
  return <section className="prsum" aria-label="What the agent did"><div className="row"><b>What the agent did</b><span className="sp" /><button className="btn sm" onClick={run(() => toast('Added the summary to the description'))}><Icon n="copy" s={12} />Add to description</button></div>
    <ul>{rows.map(([ic, txt], i) => <li key={i}><Icon n={ic} s={12} />{txt}</li>)}</ul></section>
}

/* ================================================================ G1: the PR tab for an Azure DevOps remote (same layout as GitHub) */
const AZ_CHECKS: [string, string, string][] = [['cajui-api-ci · build 2026.11.8.3', 'pass', '4 min'], ['cajui-api-ci · tests', 'pass', '6 min'], ['Policy · 2 reviewers', 'wait', '1 of 2'], ['Policy · linked work item', 'pass', 'AB#4521']]
const AZ_REVIEWERS: [string, string][] = [['Rafael Moura', 'Approved'], ['Júlia Prado', 'Waiting for author'], ['Payments team', 'No vote']]
export function AzurePrTab ({ tid }: { tid: string }) {
  const t = task(tid); if (!t) return null
  if (S.view === 'error') return <StateBlock kind="error" title="Install the Azure CLI" text="Then run az login. OXESpace uses your sign-in."><button className="btn" onClick={run(() => toast('Opens learn.microsoft.com/cli/azure in your browser'))}><Icon n="ext" s={12} />How to install</button></StateBlock>
  const vote = (v: string) => v === 'Approved' ? 'done' : v === 'Waiting for author' ? 'needs' : 'neutral'
  return <div className="scroll"><div className="detail" style={{ maxWidth: 860, padding: '18px 20px' }}>
    <div className="row"><Icon n="pr" s={16} /><h3>{t.title} <span className="muted">!4521</span></h3><span className="sp" /><span className="prov-chip az">Azure DevOps</span></div>
    <div className="row" style={{ fontSize: 12, flexWrap: 'wrap' }}><span className="pill run">Active</span><span className="mono">{t.branch}</span><Icon n="right" s={12} /><span className="mono">main</span><span className="muted mono">cajui / Payments / cajui-api</span><span className="wi">AB#4521</span></div>
    <div className="ssec"><div className="ssec-h"><h2>Pipelines and policies</h2><span className="muted" style={{ fontSize: 12 }}>3 of 4 passed</span></div>{AZ_CHECKS.map(([n, s, d]) => <div key={n} className="srow" style={{ padding: '8px 16px' }}><div className="row">{s === 'pass' ? <span style={{ color: 'var(--success)' }}><Icon n="check" /></span> : <span className="spin" />}<span>{n}</span></div><span className="num muted">{d}</span></div>)}</div>
    <div className="ssec"><div className="ssec-h"><h2>Reviewers</h2></div>{AZ_REVIEWERS.map(([n, v]) => <div key={n} className="srow" style={{ padding: '8px 16px' }}><span>{n}</span><span className={'pill ' + vote(v)}>{v}</span></div>)}</div>
    <PrSummary tid={tid} />
    <div className="row"><button className="btn" onClick={run(() => toast('Opens dev.azure.com/cajui/Payments/_git/cajui-api/pullrequest/4521'))}><Icon n="ext" s={12} />Open in Azure DevOps</button><button className="btn" onClick={run(() => toast('The agent reads the review threads and answers in the conversation'))}>Address review comments</button><span className="sp" /><button className="btn pri" disabled title="Complete happens in Azure DevOps once the policies pass">Complete</button></div></div></div>
}
