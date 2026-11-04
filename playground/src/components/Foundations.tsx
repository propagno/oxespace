/* Foundations: the reference for later UI work. Tokens are read from src/design/mandacaru-1.5.css itself,
   so this page can't drift from what the screens use. */
import tokensCss from '../design/mandacaru-1.5.css?raw'
import { PATHS } from './icons'
import { D } from '../mock/data'
import { S, emit, run, toast } from '../state/store'
import { Icon, Av, Kbd, Gauge, ACCESS } from './ui'
import { ToolRowView } from './Task'
import { Switch } from './Settings'

function parse (sel: string) {
  const i = tokensCss.indexOf(sel + ' {'); const j = tokensCss.indexOf('}', i)
  const out: Record<string, string> = {}
  tokensCss.slice(i, j).replace(/--([a-z0-9-]+):\s*([^;]+);/g, (_m: string, k: string, v: string) => { out[k] = v.trim(); return '' })
  return out
}
const LIGHT = parse('.app'), DARK = parse('.app[data-mode="dark"]')
const NEW = /^(attn|k-|syn)/
const GROUPS: [string, string, (k: string) => boolean][] = [
  ['Surfaces', 'Where things sit: canvas behind everything, base for panels, raised for cards, overlay for menus and dialogs.', k => k.startsWith('surface')],
  ['Text', 'Primary for content, secondary for supporting text, muted for labels and times. Disabled is not for reading.', k => k.startsWith('text')],
  ['Fills and borders', 'Hover, pressed and selected fills; three border weights.', k => k.startsWith('fill') || k.startsWith('border')],
  ['Accent', 'Caatinga green in both modes in 1.5: the app, and go.', k => k.startsWith('accent')],
  ['Needs you (1.5)', 'The sertão sun. Only for approvals, questions and stalled agents.', k => k.startsWith('attn')],
  ['Intent', 'Success, warning, danger and info. Never decoration.', k => /^(success|warning|danger|info)/.test(k)],
  ['Resource kinds (1.5)', 'Files, databases, containers, network and shell: tabs, chips and activity bars.', k => k.startsWith('k-')],
  ['Syntax (1.5)', 'Code in editors, blocks and approvals. Keywords purple, strings green, numbers rose, functions blue, JSON keys amber, comments muted.', k => k.startsWith('syn')],
  ['Identity and diff', 'Provider colors are the same in both modes.', k => k.startsWith('prov') || k.startsWith('diff')]
]
const isColor = (v?: string) => !!v && /^(#|rgba?\()/.test(v)

export function Foundations () {
  const keys = Object.keys(LIGHT).filter(k => isColor(LIGHT[k]))
  const icons = Object.keys(PATHS)
  return <div className="fd"><div className="fd-in">
    <header className="stack" style={{ gap: 8 }}><h1>Foundations</h1><p className="lead">Mandacaru 1.5, the tokens and primitives every 1.5.0 screen is built from. The app adopts this file through the token export (contract C4). Roles marked 1.5 are new or changed.</p>
      <div className="chips">{['Colors', 'Type', 'Space and shape', 'Motion', 'Icons', 'Components'].map(a => <a key={a} className="chip" href={'#fd-' + a.split(' ')[0].toLowerCase()} onClick={e => { e.preventDefault(); document.getElementById('fd-' + a.split(' ')[0].toLowerCase())?.scrollIntoView({ behavior: 'smooth' }) }}>{a}</a>)}</div></header>

    <section id="fd-colors"><h2>Colors</h2><p className="lead">Each swatch shows the light and the dark value. Use the role, never the hex.</p>
      {GROUPS.map(([g, d, f]) => <div key={g} className="stack" style={{ gap: 6 }}><h3 className="slabel" style={{ fontSize: 13 }}>{g}</h3><p className="muted" style={{ fontSize: 12 }}>{d}</p>
        <div className="sw-grid">{keys.filter(f).map(k => <div key={k} className={'swc' + (NEW.test(k) || (k.startsWith('accent') || k === 'fill-selected') ? ' new' : '')}><span className="sw2"><i style={{ background: LIGHT[k] }} /><i style={{ background: DARK[k] || LIGHT[k] }} /></span><div><b>{k}</b><span>{LIGHT[k]} · {DARK[k] || 'same'}</span></div></div>)}</div></div>)}</section>

    <section id="fd-type"><h2>Type</h2><p className="lead">Bricolage Grotesque for titles and the facts in an impact preview. IBM Plex Sans for the interface. IBM Plex Mono for code, paths and numbers that line up.</p>
      <div className="ty">{([['Display 30 / 700', 'f-display', 30, 700, 'Find why the report takes 40 s'], ['Title 22 / 700', 'f-display', 22, 700, 'Make charge creation idempotent'], ['Heading 16 / 600', 'f-display', 16, 600, 'Update 1,284 invoices on billing-staging'], ['Body 14 / 400', 'f-ui', 14, 400, 'Settings and the conversation read at 14 px.'], ['UI 13 / 400', 'f-ui', 13, 400, 'Lists, menus and buttons use 13 px.'], ['Small 12 / 500', 'f-ui', 12, 500, 'Labels, hints and times'], ['Mono 12 / 400', 'f-mono', 12, 400, 'src/charges/idempotency.ts  +64 −0']] as const).map(([n, f, s, w, t]) => <span key={n} style={{ display: 'contents' }}><small>{n}</small><span style={{ fontFamily: `var(--${f})`, fontSize: s, fontWeight: w, letterSpacing: s > 18 ? '-0.02em' : undefined }}>{t}</span></span>)}</div>
      <p className="muted" style={{ fontSize: 12 }}>Sentence case everywhere (U3). No uppercase labels outside this page's token names.</p></section>

    <section id="fd-space"><h2>Space and shape</h2>
      <div className="sp-row">{[4, 8, 12, 16, 20, 24, 32].map(n => <div key={n}><i style={{ width: n, height: n }} />{n}</div>)}</div>
      <div className="sp-row">{([['sm', 6], ['md', 8], ['lg', 12], ['xl', 16], ['full', 999]] as const).map(([n, r]) => <div key={n}><i style={{ width: 48, height: 32, borderRadius: r }} />radius {n}</div>)}</div>
      <div className="sp-row">{['e1', 'e2', 'e3', 'e4'].map(e => <div key={e}><i style={{ width: 72, height: 44, background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', boxShadow: `var(--${e})`, borderRadius: 8 }} />elevation {e.slice(1)}</div>)}</div>
      <p className="muted" style={{ fontSize: 12 }}>Controls are 28 px (24 px small); chips 24 px; rows 28–34 px. Hit areas are at least 24 × 24 px.</p></section>

    <section id="fd-motion"><h2>Motion</h2><p className="lead">Three durations (fast 120 ms, base 200 ms, slow 320 ms) and two signatures: new activity slides in, and the sun ring pulses on anything that needs you. Both stop with reduced motion.</p>
      <div className="motion-demo"><button className="btn" onClick={run(() => { S.fdPulse = (S.fdPulse || 0) + 1 })}>Play the slide-in</button><div key={S.fdPulse || 0} className="tr read ev new" style={{ width: 320, cursor: 'default' }}><span className="ti"><Icon n="file" s={12} /></span><span className="verb">Read</span><span className="tgt">src/charges/create.ts</span><span className="mt">146 lines</span><span /></div><span className="needs"><span className="sun live" />1 needs you</span></div></section>

    <section id="fd-icons"><h2>Icons</h2><p className="lead">{icons.length} stroke icons on a 24 px grid, 1.75 stroke, drawn at 12, 14 or 16 px. An icon never carries meaning alone; it sits with a word or an aria label.</p>
      <div className="ic-grid">{icons.map(n => <div key={n}><Icon n={n} />{n}</div>)}</div></section>

    <section id="fd-components"><h2>Components</h2><p className="lead">Each primitive in its states. Hover and focus are shown here frozen; in the screens they react to you. Rule: every button with text has a visible shape at rest (a fill or a border). Only icon buttons inside toolbars may be bare, and they always carry a tooltip and an aria label.</p>
      <div className="st-grid"><span /><small>Default</small><small>Hover</small><small>Focus</small><small>Disabled</small><small>Loading</small><small>Danger</small>
        <b>Button</b><div><button className="btn">Save</button></div><div><button className="btn is-hover">Save</button></div><div><button className="btn is-focus">Save</button></div><div><button className="btn" disabled>Save</button></div><div><button className="btn" aria-busy="true"><span className="spin" />Saving</button></div><div><button className="btn dng">Delete</button></div>
        <b>Primary</b><div><button className="btn pri">Start task</button></div><div><button className="btn pri is-hover">Start task</button></div><div><button className="btn pri is-focus">Start task</button></div><div><button className="btn pri" disabled>Start task</button></div><div><button className="btn pri"><span className="spin" style={{ borderColor: 'rgba(255,255,255,.4)', borderTopColor: '#fff' }} />Starting</button></div><div><button className="btn dng hold holding"><i className="fillbar" /><span>Hold to approve</span></button></div>
        <b>Input</b><div><input className="input" defaultValue="billing-staging" aria-label="Example" /></div><div><input className="input" placeholder="Filter tasks" aria-label="Example" /></div><div><input className="input is-focus" defaultValue="refunds" aria-label="Example" /></div><div><input className="input" disabled defaultValue="Read only" aria-label="Example" /></div><div className="stack" style={{ gap: 2 }}><div className="sk" style={{ height: 30, width: '100%' }} /></div><div className="stack" style={{ gap: 2 }}><input className="input is-err" defaultValue="5432x" aria-label="Example" /><span className="ferr"><Icon n="warn" s={12} />Use a number</span></div>
        <b>Switch</b><div><Switch on={false} label="Example" onChange={() => {}} /></div><div><Switch on label="Example" onChange={() => {}} /></div><div><span className="is-focus" style={{ borderRadius: 999, display: 'inline-flex' }}><Switch on label="Example" onChange={() => {}} /></span></div><div><Switch on label="Example" disabled onChange={() => {}} /></div><div><Switch on={false} risky label="Example" onChange={() => {}} /></div><div><Switch on risky label="Example" onChange={() => {}} /></div>
        <b>Chip</b><div><button className="chip">Read only</button></div><div><button className="chip" style={{ background: 'var(--fill-hover)' }}>Read only</button></div><div><button className="chip is-focus">Read only</button></div><div><button className="chip" disabled style={{ opacity: .5 }}>Read only</button></div><div><button className="chip" aria-pressed="true">Selected</button></div><div><button className="chip dz" aria-pressed="true">Full access</button></div></div></section>

    <section><h3 className="slabel" style={{ fontSize: 13 }}>Composer chips (T58 §4)</h3><div className="demo-row">
      <span className="chp"><span className="pdot claude" /><span>Opus 5.5</span></span><span className="chp eff"><Gauge level="High" /><span>High</span></span>
      {(['read', 'edit', 'full'] as const).map(a => <span key={a} className={'chp ' + ACCESS[a][2]}><Icon n={ACCESS[a][0]} s={12} /><span>{ACCESS[a][1]}</span></span>)}<span className="chp edit pend"><Icon n="pencil" s={12} /><span>Next message</span></span>
      <div className="segm"><button className="plan" aria-pressed="true">Plan</button><button>Agent</button></div><button className="send" aria-label="Send"><Icon n="up" /></button><button className="stopb" aria-label="Stop"><Icon n="stop" /></button></div></section>

    <section><h3 className="slabel" style={{ fontSize: 13 }}>Tool rows by kind (T58 §2.3)</h3><div className="trs" style={{ marginLeft: 0, maxWidth: 640 }}>
      {([['read', 'Read', 'src/reports/invoice-report.ts', '212 lines'], ['edit', 'Edit', 'src/charges/create.ts', '+38 −12'], ['run', 'Shell', 'npm test -- charges', '24 passed'], ['fail', 'Shell', 'npm run lint', '1 error'], ['run', 'Shell', 'npm test -- charges', 'running', '', true]] as [string, string, string, string, string?, boolean?][]).map((r, i) => <ToolRowView key={i} r={r} k={'fd' + i} still />)}</div></section>

    <section><h3 className="slabel" style={{ fontSize: 13 }}>Status, kinds and messages</h3>
      <div className="demo-row">{['needs', 'run', 'review', 'done', 'err', 'idle'].map(s => <span key={s} className="row" style={{ gap: 6, fontSize: 12 }}><span className={'sg ' + s} />{({ needs: 'Needs you', run: 'Running', review: 'Ready for review', done: 'Done', err: 'Stopped', idle: 'Paused' } as Record<string, string>)[s]}</span>)}</div>
      <div className="demo-row">{(['file', 'db', 'box', 'net', 'shell'] as const).map(k => <span key={k} className={'kchip ' + k}><Icon n={k === 'shell' ? 'shell' : k} s={12} />{({ file: 'files', db: 'billing-staging', box: 'pix-mock', net: 'sandbox', shell: 'npm test' } as Record<string, string>)[k]}</span>)}<span className="pill irrev">Can't be undone</span><span className="pill rev">Can be undone</span><Kbd>Ctrl K</Kbd></div>
      <div className="stack" style={{ maxWidth: 640 }}>{([['info', 'info', 'Codex can\'t fork a session, so the conversation is replayed.'], ['warn', 'warn', 'Only files go back. Queries and requests already happened.'], ['danger', 'warn', 'This can\'t be undone. Hold Approve for 1.2 s.'], ['ok', 'check', 'Ran after your approval: 1,284 rows changed.']] as const).map(([k, i, t]) => <div key={k} className={'callout ' + k}><Icon n={i} /><span>{t}</span></div>)}</div>
      <div className="demo-row"><div className="toast" style={{ animation: 'none' }}><span>Approved: Update 1,284 invoices</span><button className="btn sm" onClick={() => { toast('Undo clicked in the example'); emit() }}><Icon n="undo" s={12} />Undo</button></div><div className="toast attn" style={{ animation: 'none' }}><span className="sun live" /><span>Claude needs you on T-142</span></div></div>
      <div className="demo-row"><div className="m-you" style={{ justifySelf: 'start' }}>Make POST /charges idempotent.</div><div className="m-ag" style={{ maxWidth: 420 }}><Av p="claude" /><div className="body">Plan: store each key with a hash of the body for 24 h.</div></div></div></section>

    <section><h3 className="slabel" style={{ fontSize: 13 }}>Loading, empty and error</h3><div className="cards2">
      <div className="mcard"><div className="sk" style={{ height: 14, width: '60%' }} /><div className="sk" style={{ height: 40 }} /><div className="sk" style={{ height: 14, width: '80%' }} /><span>Skeleton at final size; never a spinner line (X9).</span></div>
      <div className="mcard" style={{ textAlign: 'center', justifyItems: 'center' }}><span className="ico" style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--surface-sunken)' }}><Icon n="db" s={16} /></span><b style={{ color: 'var(--text-primary)' }}>No queries</b><span>Says what will appear and how to start.</span></div>
      <div className="mcard" style={{ textAlign: 'center', justifyItems: 'center' }}><span className="ico" style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}><Icon n="warn" s={16} /></span><b style={{ color: 'var(--text-primary)' }}>Couldn't load this task</b><span>What failed, that nothing was lost, and Try again.</span></div></div></section>
    <p className="muted" style={{ fontSize: 12 }}>Providers: {Object.values(D.providers).map(p => p.name).join(' and ')}. Identity colors don't change between modes.</p>
  </div></div>
}
