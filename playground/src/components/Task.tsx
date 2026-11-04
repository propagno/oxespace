/* Direction B, lite (1.5.0): one task = one conversation. Its tabs come from that conversation's agent activity. */
import { D } from '../mock/data'
import type { Task, ConvItem, ToolRow } from '../mock/types'
import { S, emit, run, task, cur, prov, plural, money, fmtElapsed, cmpState, scState, sendMsg, addCheckpoint, toast, resolve, raisePush, type Cmp } from '../state/store'
import { Icon, Av, Kbd, Gauge, Ring, Html, MI, menuBtn, StateBlock, ACCESS, toastSoon } from './ui'
import { MENUS } from './Shell'
import { syncScreen, goScreen } from '../screens/registry'
import { ToolTab, Highlight, DiffFile, placesFor } from './Tools'
import { isRich, RichItem, decideCmd } from './Thread'
import { CodeBlock, type Lang } from './Code'

/* ================================================================ sidebar (T61: collapsed keeps every item) */
const GROUPS: [string, string][] = [['needs', 'Needs you'], ['run', 'Running'], ['review', 'Ready for review'], ['err', 'Stopped'], ['done', 'Done']]
export const STATUS_LABEL: Record<string, string> = { needs: 'Needs you', run: 'Running', review: 'Ready for review', err: 'Stopped', done: 'Done', idle: 'Paused' }
export function openTask (id: string) { S.notif = false; S.area = 'task'; S.emptyWs = false; S.taskId = id; S.tab = 'conv'; S.menu = null; D.notifications.forEach(n => { if (n.task === id) S.notifRead[n.id] = true }); syncScreen(); emit() }

export function Sidebar () {
  const col = S.sbCol
  const list = S.emptyWs ? [] : S.tasks.filter(t => t.id !== 'quick' && (!S.projFilter || t.project === S.projFilter) && (!S.filter || (t.title + t.key).toLowerCase().includes(S.filter.toLowerCase())))
  const groups = GROUPS.map(([k, l]) => [k, l, list.filter(t => (t.status === 'idle' ? 'run' : t.status) === k)] as const).filter(g => g[2].length)
  return <aside className={'sbar' + (col ? ' col' : '')} aria-label="Tasks">
    <div className="sbar-h"><h2>Tasks</h2><button className="ibtn" onClick={run(() => { S.overlay = { type: 'newtask', text: '' } })} title="New task (N)" aria-label="New task"><Icon n="plus" /></button>
      <button className="ibtn" onClick={run(() => { S.sbCol = !S.sbCol; syncScreen() })} title={`${col ? 'Expand' : 'Collapse'} the task list (Ctrl B)`} aria-label={`${col ? 'Expand' : 'Collapse'} the task list`}><Icon n="sidebar" /></button></div>
    <div className="sbar-tools"><label className="search"><Icon n="search" s={12} /><input id="tsearch" placeholder="Filter tasks" aria-label="Filter tasks" value={S.filter || ''} onChange={e => { S.filter = e.target.value; emit() }} /></label>
      <button className="btn sm" onClick={menuBtn('proj')} aria-haspopup="menu">{S.projFilter ? D.projects[S.projFilter].name : 'All projects'}<Icon n="down" s={12} /></button></div>
    <div className="sbar-l">{list.length ? groups.map(([k, l, ts]) => <div key={k}><div className="tg"><span>{l}</span><span className="n">{ts.length}</span></div>
      {ts.map(t => { const on = (S.area === 'task' || S.area === 'later-multi') && S.taskId === t.id
        return <button key={t.id} className="trow" onClick={() => openTask(t.id)} aria-current={on ? 'page' : undefined} aria-label={`${t.key} ${t.title}, ${STATUS_LABEL[t.status]}`}>
          <span className={'sg ' + t.status} /><span className="tt trunc">{t.title}</span><span className="tm">{t.status === 'run' || t.status === 'needs' ? t.mins + 'm' : t.started}</span>
          {t.status === 'needs' ? <span className="meta"><span className="trunc attn-t">{t.now.replace('Waiting for you: ', 'Asks to ').replace('Waiting for your answer: ', 'Asks you ')}</span></span> : null}
          <span className="key">{t.key.slice(2)}</span>{col ? <span className="tipc">{t.key} · {t.title} · {STATUS_LABEL[t.status]}</span> : null}</button> })}</div>)
      : col ? null : <div className="state" style={{ padding: '24px 12px' }}><p style={{ fontSize: 12 }}>{S.filter ? `No task matches "${S.filter}".` : 'No tasks yet. A task is one conversation with an agent, with everything it touches.'}</p></div>}</div>
    <div className="sbar-f">{col ? <button className="ibtn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'archived' } })} aria-label="Archived tasks" title="Archived tasks"><Icon n="archive" s={12} /></button>
      : <><button className="btn ghost sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'archived' } })}><Icon n="archive" s={12} /><span className="lbl">Archived · 14</span></button><span className="sp" /><span className="lbl">{plural(list.length, 'task')}</span></>}</div></aside>
}
MENUS.proj = () => <><MI check={!S.projFilter} label="All projects" onClick={() => { S.projFilter = null }} />{Object.values(D.projects).map(p => <MI key={p.id} check={S.projFilter === p.id} label={p.name} hint={p.stack} onClick={() => { S.projFilter = p.id }} />)}<hr /><MI icon="plus" label="Add project…" onClick={() => { S.overlay = { type: 'dlg', id: 'addproject' } }} /></>

export function EmptyHome () {
  const nt = (text: string) => run(() => { S.overlay = { type: 'newtask', text } })
  return <div className="state" style={{ height: '100%' }}><span className="ico"><Icon n="sparkle" s={16} /></span><h3>Start your first task</h3>
    <p>Describe what you want done. The agent gets its own branch and worktree, and everything it runs, queries or changes stays with the task.</p>
    <div className="row"><button className="btn pri" onClick={nt('')}><Icon n="plus" s={12} />New task <Kbd>N</Kbd></button></div>
    <div className="suggest"><button onClick={nt('Find why the monthly invoice report is slow on staging')}><b>Investigate a slow report</b>Queries billing-staging, read only</button><button onClick={nt('Write tests for the Pix webhook handler')}><b>Write missing tests</b>cajui-api · own worktree</button><button onClick={nt('Explain how settlements are batched')}><b>Explain some code</b>Read only, no changes</button><button onClick={nt('Upgrade docker-compose to Postgres 17')}><b>Upgrade a dependency</b>cajui-infra · containers</button></div></div>
}

/* ================================================================ task view */
const TABS: [string, string, string, string, keyof Task['counts'] | 'pr' | null][] = [['conv', 'chat', 'Conversation', '', null], ['terminal', 'term', 'Terminal', 'k-shell', 'terminal'], ['queries', 'db', 'Queries', 'k-db', 'queries'], ['requests', 'net', 'Requests', 'k-net', 'requests'], ['containers', 'box', 'Containers', 'k-box', 'containers'], ['changes', 'diff', 'Changes', 'k-file', 'changes'], ['pr', 'pr', 'Pull request', 'k-pr', 'pr']]
export function TaskView () {
  const t = cur(); if (!t) return null
  const sc = S.sideChat[t.id]?.open
  const rp = S.w === 900 ? S.rp900 && !sc : S.rp && !sc
  // Only the tools this task used. Conversation is always there; Pull request once there is one or the work is done.
  const tabs = TABS.filter(([, , , , cnt]) => !cnt || (cnt === 'pr' ? !!t.pr || ['review', 'done'].includes(t.status) : t.counts[cnt] > 0))
  return <div className={'taskv' + (rp ? '' : ' norp') + (sc ? ' sc' : '')}>
    <section className="tcol" aria-label={t.title}><TaskHeader t={t} />
      <div className="tabs" role="tablist" aria-label="Task tools">{tabs.map(([id, , lbl, , cnt]) => { const n = cnt && cnt !== 'pr' ? t.counts[cnt] : null
        return <button key={id} role="tab" aria-selected={S.tab === id} onClick={() => { S.tab = id; syncScreen(); emit() }}><span className="lbl2">{lbl}</span>{n ? <span className="n">{n}</span> : null}</button> })}</div>
      <div className="tbody">{S.view === 'loading' ? <StateBlock kind="loading" /> : S.view === 'error' ? <StateBlock kind="error" /> : S.tab === 'conv' ? <Conversation t={t} /> : <ToolTab t={t} tab={S.tab} />}</div></section>
    {sc ? <SideChatPanel t={t} /> : null}
    {rp ? <RightPanel t={t} /> : null}</div>
}
/** One line that answers "what is it doing, and do I need to act?" */
function NowLine ({ t }: { t: Task }) {
  const ap = t.gate && !S.resolved[t.gate] ? D.approvals[t.gate] : null
  const who = prov(t.prov).name
  const goAsk = () => document.getElementById('ask-' + t.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (t.ask === 'cmd') return <div className="nowline attn" role="status"><span className="sun live" /><span className="what"><b>Waiting for you.</b> {who} wants to run <span className="mono">npm test -- refunds</span>.</span><button className="btn sm" onClick={run(() => decideCmd(t, 'deny'))}>Deny</button><button className="btn sm pri" onClick={goAsk}>Review</button></div>
  if (t.ask) return <div className="nowline attn" role="status"><span className="sun live" /><span className="what"><b>Waiting for you.</b> {who} asked 2 questions before writing the tests.</span><button className="btn sm pri" onClick={goAsk}>Answer</button></div>
  if (ap) return <div className="nowline attn" role="status"><span className="sun live" /><span className="what"><b>Waiting for you.</b> {who} asks to {ap.title.charAt(0).toLowerCase() + ap.title.slice(1)}.</span>
    <button className="btn sm" onClick={run(() => resolve(ap.id, 'deny'))}>Deny</button><button className="btn sm pri" onClick={run(() => { S.overlay = { type: 'approve', id: ap.id } })}>See impact</button></div>
  if (t.status === 'run') return <div className="nowline run" role="status"><span className="spin" /><span className="what"><b>Working.</b> {t.now}.</span><span className="num muted">{fmtElapsed(S.running[t.id] ?? 72)}</span>
    <button className="btn sm" onClick={run(() => { t.status = 'idle'; t.now = 'Stopped by you'; toast(`Stopped ${t.key}. The work so far is kept.`) })}><Icon n="stop" s={12} />Stop</button></div>
  if (t.status === 'idle') return <div className="nowline idle" role="status"><Icon n="warn" s={12} /><span className="what"><b>Paused.</b> You stopped it. The work so far is kept; send a message to continue.</span></div>
  if (t.status === 'err') return <div className="nowline err" role="status"><Icon n="warn" s={12} /><span className="what"><b>Stopped with an error.</b> {t.now.replace('Stopped: ', '')}.</span><button className="btn sm" onClick={run(() => { t.status = 'run'; t.now = 'Recreating the volume'; S.conv[t.id].push({ you: 'Retry with a fresh volume.', at: '14:44' }) })}><Icon n="refresh" s={12} />Retry</button></div>
  if (t.status === 'review') return <div className="nowline ok" role="status"><Icon n="check" s={12} /><span className="what"><b>Ready for review.</b> {t.now}.</span>{t.pr ? <button className="btn sm" onClick={run(() => { S.tab = 'pr'; syncScreen() })}>Open pull request</button> : null}</div>
  return <div className="nowline ok" role="status"><Icon n="check" s={12} /><span className="what"><b>Done.</b> {t.now}.</span></div>
}
function TaskHeader ({ t }: { t: Task }) {
  const p = D.projects[t.project]; const later = S.area === 'later-multi'
  const rpOn = S.w === 900 ? S.rp900 : S.rp
  return <header className="th"><div className="th-top"><span className={'sg ' + t.status} aria-hidden="true" /><h1>{t.title}</h1>
    <div className="hdr-acts">
      <button className="ibtn" onClick={run(() => { const s = scState(t); s.open = !s.open; syncScreen(); if (s.open) setTimeout(() => document.getElementById('sc-' + t.id)?.focus(), 0) })} aria-pressed={!!S.sideChat[t.id]?.open} title="Side chat: ask about this task without changing it (Ctrl .)" aria-label="Side chat"><Icon n="copy" /></button>
      <button className="ibtn" onClick={run(() => { if (S.w === 900) S.rp900 = !S.rp900; else S.rp = !S.rp })} aria-pressed={rpOn} title={rpOn ? 'Hide the task panel' : 'Show the task panel'} aria-label="Task panel"><Icon n="panel" /></button>
      <button className="ibtn" onClick={menuBtn('convact')} aria-haspopup="menu" aria-label="More task actions" aria-expanded={S.menu?.id === 'convact'}><Icon n="more" /></button></div></div>
    <div className="th-sub">{later ? <><Av p="claude" size="s16" /><Av p="codex" size="s16" />2 agents</> : <><Av p={t.prov} size="s16" />{prov(t.prov).name} · {t.model}</>}<span>·</span><span>{p.name}</span><span>·</span><span className="num">{t.mins} min</span><span>·</span><span className="num" title={t.costEst ? 'Codex doesn\'t report cost; estimated from tokens' : 'Reported by Claude Code'}>{t.costEst ? '≈ ' : ''}{money(t.cost)}</span></div>
    <NowLine t={t} /></header>
}
MENUS.convact = () => { const t = cur(); return <><MI icon="pencil" label="Rename" sc="/rename" onClick={() => { S.overlay = { type: 'dlg', id: 'rename' } }} /><MI icon="pin" label={t.pinned ? 'Unpin' : 'Pin to the top'} onClick={() => { t.pinned = !t.pinned; toast(t.pinned ? `Pinned ${t.key}` : `Unpinned ${t.key}`) }} /><MI icon="users" label="Delegate to a teammate…" onClick={() => { S.overlay = { type: 'dlg', id: 'delegate' } }} /><MI icon="plug" label="MCP servers…" onClick={() => { S.overlay = { type: 'dlg', id: 'mcp' } }} /><hr />
  <MI check={S.bigText} label="Larger text" onClick={() => { S.bigText = !S.bigText }} /><MI check={S.verbose} label="Show every tool call in full" onClick={() => { S.verbose = !S.verbose; if (S.verbose) (S.conv[t.id] || []).forEach((it, i) => it.tools && it.tools.forEach((r, j) => { if (r[4]) S.open[`${t.id}:${i}:${j}`] = true })) }} /><MI icon="info" label="Conversation details" sc="Ctrl I" onClick={() => { S.rp = true; S.rp900 = true; S.rpTab = 'details'; syncScreen() }} /><hr />
  <MI icon="fork" label="Fork" sc="/fork" dis={t.prov !== 'codex'} title={t.prov !== 'codex' ? 'Fork is available for Codex conversations' : undefined} onClick={() => { S.overlay = { type: 'dlg', id: 'branch', ck: 'message' } }} /><MI icon="download" label="Export" onClick={() => toast(`Exported ${t.key}.md to Downloads`)} />
  <MI icon="archive" label="Archive" sc="/archive" onClick={() => { const idx = S.tasks.indexOf(t); S.tasks.splice(idx, 1); S.taskId = S.tasks[0].id; toast(`Archived ${t.key}`, { undo: () => { S.tasks.splice(idx, 0, t); S.taskId = t.id; emit() } }) }} /><hr />
  <MI icon="trash" dz label="Delete…" sc="/delete" onClick={() => { S.overlay = { type: 'dlg', id: 'deletetask' } }} /></> }

/* ---------------------------------------------------------------- conversation (T58 §2) */
export function Conversation ({ t, empty }: { t: Task; empty?: React.ReactNode }) {
  const items = S.conv[t.id] || []; const past = S.past[t.id]
  let ck = -1
  const running = t.status === 'run'
  return <div className="conv-wrap">
    {past != null ? <div className="past-banner"><Icon n="history" s={12} /><span>Viewing checkpoint {past} · {D.checkpoints[t.id]?.[past]?.at}. Later messages are dimmed; files on disk are unchanged.</span><span className="sp" />
      <button className="btn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'restore', ck: past } })}>Restore files…</button><button className="btn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'branch', ck: past } })}><Icon n="fork" s={12} />Branch from here</button><button className="btn sm pri" onClick={run(() => { delete S.past[t.id] })}>Back to now <Kbd>L</Kbd></button></div> : null}
    <div className={'conv' + (S.bigText ? ' big' : '')} role="log" aria-label="Conversation" ref={el => { if (el && el.dataset.tid !== t.id) { el.dataset.tid = t.id; delete el.dataset.seen; setTimeout(() => { el.scrollTop = el.scrollHeight }, 60) } pinBottom(el) }}><div className="conv-in">
      {!items.length && empty ? empty : null}{items.map((it, i) => { if (it.ck != null) ck = it.ck; const dim = past != null && (it.ck != null ? it.ck > past : ck > past); return <div key={i} className={dim ? 'inpast' : undefined} style={{ display: 'contents' }}><Item t={t} it={it} i={i} /></div> })}
      {t.status === 'idle' ? <div className="turn" style={{ color: 'var(--warning-fg)' }}><Icon n="warn" s={12} />Interrupted. The work so far is kept; send a message to continue.</div> : null}
    </div></div><Composer t={t} /></div>
}
/** Keep a log pinned to the bottom unless the reader scrolled up. */
export function pinBottom (el: HTMLElement | null) {
  if (!el) return
  const atEnd = el.dataset.seen ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 + (+(el.dataset.grow || 0)) : true
  if (atEnd) el.scrollTop = el.scrollHeight
  el.dataset.seen = '1'
  if (!el.dataset.l) { el.dataset.l = '1'; el.addEventListener('scroll', () => { el.dataset.grow = '0' }) }
}
function Item ({ t, it, i }: { t: Task; it: ConvItem; i: number }) {
  if (isRich(it)) return <RichItem t={t} it={it} i={i} />
  if (it.you) return <><div className="m-you">{it.images ? <div className="att">{it.images.map(f => <span key={f} className="img"><span className="thumb" aria-hidden="true" />{f}</span>)}</div> : null}{it.files ? <div className="att">{it.files.map(f => <span key={f}><Icon n="clip" s={12} />{f}</span>)}</div> : null}<div title={it.at}>{it.you}</div></div></>
  if (it.agent) return <div className="m-ag"><Av p={t.prov} /><div className="body"><Html as="div" html={it.agent} />{it.code ? <CodeBlock lang={it.code[0] as Lang} title={it.code[1]} code={it.code[2]} /> : null}</div>
    <div className="hov"><button className="ibtn sm" onClick={run(() => toast('Copied to the clipboard'))} title="Copy" aria-label="Copy message"><Icon n="copy" s={12} /></button><button className="ibtn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'branch', ck: 'message' } })} title="Branch from this message" aria-label="Branch from this message"><Icon n="fork" s={12} /></button></div></div>
  if (it.tools) return <ToolGroup t={t} rows={it.tools} k={`${t.id}:${i}`} />
  if (it.ck != null) return <div className="ck3"><span>Checkpoint {it.ck} · {it.label}</span><button onClick={run(() => { S.past[t.id] = it.ck!; syncScreen() })}>View</button></div>
  if (it.gate) return S.resolved[it.gate] ? null : <div className="gate-mark"><span className="sun live" />Asked to {D.approvals[it.gate].verb.charAt(0).toLowerCase() + D.approvals[it.gate].verb.slice(1)} · waiting for you (top of the task)</div>
  if (it.done) return <div className="apc done"><div className="apc-h"><Icon n={it.how === 'deny' ? 'x' : 'check'} s={12} />{it.how === 'deny' ? 'You denied' : it.how === 'snap' ? 'You took a snapshot, then approved' : 'You approved'}: {D.approvals[it.done].title} · {it.at}</div></div>
  if (it.err) return <div className="callout danger" style={{ marginLeft: 30 }}><Icon n="warn" /><div><b>Stopped.</b> {it.err}<div className="row" style={{ marginTop: 6 }}><button className="btn sm" onClick={run(() => { S.tab = 'containers' })}>Open containers</button><button className="btn sm" onClick={run(() => { t.status = 'run'; t.now = 'Recreating the volume'; S.conv[t.id].push({ you: 'Retry with a fresh volume.', at: '14:44' }); toast(`Codex is retrying ${t.key}`) })}><Icon n="refresh" s={12} />Retry with a fresh volume</button></div></div></div>
  return null
}
const TK: Record<string, [string, string]> = { read: ['read', 'file'], edit: ['edit', 'pencil'], run: ['run', 'shell'], fail: ['fail', 'warn'], done: ['', 'check'] }
export function ToolRowView ({ r, k, still }: { r: ToolRow; k: string; still?: boolean }) {
  const [kind, verb, target, meta, detail, running] = r
  const icon = verb === 'Query' ? 'db' : verb === 'Request' ? 'net' : verb === 'Container' ? 'box' : verb === 'Search' ? 'search' : TK[kind][1]
  const canOpen = !still && (!!detail || verb === 'Query' || verb === 'Request' || kind === 'edit'); const open = canOpen && !!S.open[k]
  const link = verb === 'Query' ? 'queries' : verb === 'Request' ? 'requests' : kind === 'edit' ? 'changes' : null
  return <><button className={'tr ' + TK[kind][0]} onClick={canOpen ? run(() => { S.open[k] = !S.open[k] }) : undefined} aria-expanded={canOpen ? open : undefined} style={canOpen ? undefined : { cursor: 'default' }}>
    <span className="ti">{running ? <span className="spin" /> : <Icon n={icon} s={12} />}</span><span className="verb">{verb}</span><span className="tgt">{target}</span><span className="mt">{meta}</span><span className="chev">{canOpen ? <Icon n="right" s={12} /> : null}</span></button>
    {open && kind === 'edit' ? <EditDetail tid={k.split(':')[0]} path={target} /> : open ? <div className="trd">{detail || target}{link ? <>{'\n\n'}<button className="lk" onClick={run(() => { S.tab = link; syncScreen() })}>Open in {link === 'queries' ? 'Queries' : link === 'requests' ? 'Requests' : 'Changes'} →</button></> : null}</div> : null}</>
}
function GateCard ({ t, id }: { t: Task; id: string }) {
  const ap = D.approvals[id]
  return <div className="apc docked" role="region" aria-label="Waiting for your approval"><div className="apc-h"><span className="sun live" />{prov(t.prov).name} needs your approval</div><h3>{ap.title}</h3><p>{ap.why}</p>
    <div className="apc-facts"><span className={'kchip ' + ap.kind}><Icon n={ap.kind} s={12} />{ap.where}</span><span className="kchip shell"><b>{ap.rows}</b> {ap.rowsSub}</span><span className={'pill ' + (ap.irreversible ? 'irrev' : 'rev')}>{ap.irreversible ? 'Can\'t be undone' : 'Can be undone'}</span></div>
    <pre className="code"><Highlight s={ap.sql} lang={ap.lang} /></pre>
    <div className="apc-acts"><button className="btn" onClick={run(() => resolve(id, 'deny'))}>Deny <Kbd>D</Kbd></button><button className="btn pri" onClick={run(() => { S.overlay = { type: 'approve', id } })}><Icon n="eye" s={12} />See impact and approve</button><span className="sp" /><button className="btn ghost sm" onClick={run(() => toast('Copied the exact text'))}><Icon n="copy" s={12} />Copy exact text</button></div></div>
}

/* ---------------------------------------------------------------- composer (T58 §3–4) */
export function Chips ({ t, c, side }: { t: Task; c: Cmp; side?: boolean }) {
  const acc = ACCESS[c.access]
  return <>
    <button className={'chp' + (c.pend.model ? ' pend' : '')} onClick={menuBtn(side ? 'scmodel' : 'model', true)} aria-label={`Model: ${c.model}`} title={c.pend.model ? 'Applies to the next message' : side ? 'For the side chat only' : `${c.model} · ${prov(t.prov).name}`}><span className={'pdot ' + t.prov} /><span>{c.model}</span></button>
    {prov(t.prov).efforts.length ? <button className={'chp eff' + (c.pend.effort ? ' pend' : '')} onClick={menuBtn(side ? 'sceffort' : 'effort', true)} aria-label={`Effort: ${c.effort}`} title={c.pend.effort ? 'Applies to the next message' : side ? 'For the side chat only' : `Effort: ${c.effort}`}><Gauge level={c.effort} /><span>{c.effort}</span></button> : null}
    {side ? <span className="chp read acc-chip" aria-disabled="true" title="The side chat can only read" aria-label="Permissions: Read only"><Icon n="eye" s={12} /><span>Read only</span><Icon n="lock" s={12} /></span>
      : <button className={`chp acc-chip ${acc[2]}${c.pend.access ? ' pend' : ''}`} onClick={menuBtn('access', true)} aria-label={`Permissions: ${acc[1]}`} title={c.pend.access ? 'Applies to the next message' : `Permissions: ${acc[1]}`}><Icon n={acc[0]} s={12} /><span>{acc[1]}</span></button>}</>
}
export function Composer ({ t }: { t: Task }) {
  const c = cmpState(t); const running = t.status === 'run'; const draft = S.drafts[t.id] || ''
  return <div className="cmp-wrap"><div className="cmp-in">
    {(S.queued[t.id] || []).length ? <div className="queued">{S.queued[t.id].map((q, n) => <div key={n} className="qitem"><Icon n="clock" s={12} /><span className="trunc"><b>Queued</b> · {q}</span><button className="btn sm" onClick={run(() => { S.queued[t.id].splice(n, 1); S.conv[t.id].push({ you: q, at: '14:57' }); toast('Sent now. The agent reads it after its current step.') })}>Send now</button><button className="ibtn sm" aria-label="Remove from queue" onClick={run(() => { S.queued[t.id].splice(n, 1) })}><Icon n="x" s={12} /></button></div>)}</div> : null}
    <div className="cmp"><textarea id={'cmp-' + t.id} rows={2} value={draft} aria-label={`Message to ${prov(t.prov).name}`}
      placeholder={t.ask ? 'Answer above, or type to tell Claude something else' : running ? 'Steer: the agent reads this after its current step' : t.status === 'needs' ? 'Answer, or tell the agent what to do instead' : 'Ask, or type / for commands'}
      onChange={e => { S.drafts[t.id] = e.target.value; emit() }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(t); emit() } }} />
      <div className="strip"><button className="ibtn" onClick={menuBtn('slash')} title="Commands (/)" aria-label="Commands"><Icon n="slash" /></button><button className="ibtn" onClick={() => toastSoon('In the app this opens the file picker; attachments show as chips in the bubble.')} title="Add files" aria-label="Add files"><Icon n="plus" /></button>
        {t.id === 'quick' ? null : <div className="segm" role="group" aria-label="Mode"><button className="plan" aria-pressed={c.mode === 'plan'} onClick={run(() => { c.mode = 'plan' })} title="Plan: nothing changes until you agree">Plan</button><button aria-pressed={c.mode === 'agent'} onClick={run(() => { c.mode = 'agent' })}>Agent</button></div>}
        <Chips t={t} c={c} /><span className="sp" /><Ring pct={t.ctx[0]} />
        {running ? <><button className="ibtn" onClick={run(() => { if (!draft.trim()) { toast('Type a note first; the agent reads it after its current step.'); return } S.conv[t.id].push({ you: draft, at: '14:43' }); S.drafts[t.id] = ''; toast(`Steer sent. ${t.model} reads it between steps.`) })} title="Steer now (Ctrl Enter)" aria-label="Steer"><Icon n="compass" /></button>
          <button className="stopb" onClick={run(() => { t.status = 'idle'; t.now = 'Stopped by you'; toast(`Stopped ${t.key}. The work so far is kept.`) })} title="Stop (Esc Esc)" aria-label="Stop"><Icon n="stop" /></button></> : null}
        <button className="send" disabled={!draft.trim()} onClick={run(() => sendMsg(t))} title={running ? 'Queue for after this step (Enter)' : 'Send (Enter)'} aria-label="Send"><Icon n="up" /></button></div></div>
  </div></div>
}
const setC = (k: 'model' | 'effort' | 'access', v: string) => () => { const t = cur(); const c = cmpState(t); if (k === 'access' && v === 'full') { S.overlay = { type: 'dlg', id: 'fullaccess' }; return } if (c[k] !== v) { (c as unknown as Record<string, string>)[k] = v; c.pend[k] = true } }
const hintFor = (m: string) => m.includes('Opus') ? 'Most capable · slower' : m.includes('Haiku') || m.includes('mini') ? 'Fast and cheap' : m.includes('Sonnet') ? 'Balanced' : 'Tuned for code'
MENUS.model = () => { const t = cur(), c = cmpState(t); return <><div className="slabel">Model · {prov(t.prov).name}</div>{prov(t.prov).models.map(m => <MI key={m} check={c.model === m} label={m} hint={hintFor(m)} onClick={setC('model', m)} />)}<div className="muted" style={{ fontSize: 11 }}>A change applies to the next message.</div></> }
MENUS.effort = () => { const t = cur(), c = cmpState(t); return <><div className="slabel">Effort</div>{prov(t.prov).efforts.map(m => <MI key={m} check={c.effort === m} label={m} onClick={setC('effort', m)} />)}<div className="muted" style={{ fontSize: 11 }}>More effort thinks longer and costs more.</div></> }
MENUS.access = () => { const c = cmpState(cur()); return <><div className="slabel">What the agent may do</div><MI icon="eye" label="Read only" hint="Reads files and runs safe commands" onClick={setC('access', 'read')} /><MI icon="pencil" label="Can edit" hint="Edits this task's worktree; asks before anything else" onClick={setC('access', 'edit')} /><MI icon="shieldx" dz label="Full access…" hint="Runs anything without asking" onClick={setC('access', 'full')} /><div className="muted" style={{ fontSize: 11 }}>Now: {ACCESS[c.access][1]}</div></> }
MENUS.scmodel = () => { const t = cur(), s = scState(t); return <><div className="slabel">Model · side chat only</div>{prov(t.prov).models.map(m => <MI key={m} check={s.model === m} label={m} hint={hintFor(m)} onClick={() => { s.model = m }} />)}</> }
MENUS.sceffort = () => { const t = cur(), s = scState(t); return <><div className="slabel">Effort · side chat only</div>{prov(t.prov).efforts.map(m => <MI key={m} check={s.effort === m} label={m} onClick={() => { s.effort = m }} />)}</> }
MENUS.slash = () => <><div className="mg">Commands</div>{([['compact', 'Compact the conversation'], ['checkpoint', 'Make a checkpoint now'], ['review', 'Review the changes'], ['pr', 'Open a pull request'], ['status', 'Status'], ['rename', 'Rename the task']] as const).map(([k, l]) => <MI key={k} icon="slash" label={l} sc={'/' + k} onClick={() => { if (k === 'pr') S.tab = 'pr'; else if (k === 'rename') S.overlay = { type: 'dlg', id: 'rename' }; else if (k === 'checkpoint') addCheckpoint(cur(), 'Made by you'); else if (k === 'status') { S.rp = true; S.rpTab = 'details' } else toast(`/${k} sent to the agent`) }} />)}</>

/* ---------------------------------------------------------------- right panel */
function RightPanel ({ t }: { t: Task }) {
  return <aside className="rp" aria-label="Task panel"><div className="rp-h"><div className="segc" role="tablist"><button role="tab" aria-pressed={S.rpTab === 'overview'} onClick={run(() => { S.rpTab = 'overview'; syncScreen() })}>Overview</button><button role="tab" aria-pressed={S.rpTab === 'details'} onClick={run(() => { S.rpTab = 'details'; syncScreen() })}>Details</button></div><span className="sp" /><button className="ibtn sm" onClick={run(() => { if (S.w === 900) S.rp900 = false; else S.rp = false })} aria-label="Hide the task panel" title="Hide"><Icon n="x" s={12} /></button></div>
    <div className="rp-b">{S.view === 'loading' ? <StateBlock kind="loading" /> : S.rpTab === 'details' ? <Details t={t} /> : <Overview t={t} />}</div></aside>
}
function Overview ({ t }: { t: Task }) {
  const ch = D.changes[t.id] || []; const add = ch.reduce((n, f) => n + f.add, 0), del = ch.reduce((n, f) => n + f.del, 0)
  const qs = D.queries.filter(q => q.task === t.id), rq = Object.values(D.requests).filter(r => r.task === t.id), cs = D.containers.filter(c => c.task === t.id)
  const cks = D.checkpoints[t.id] || []; const pr = t.pr ? D.prs[t.pr] : null; const past = S.past[t.id]
  const tab = (v: string) => run(() => { S.tab = v; syncScreen() })
  const conns = Array.from(new Set(qs.map(q => q.conn)))
  const rows: [string, string, React.ReactNode, string][] = []
  if (ch.length) rows.push(['file', 'k-file', <>{plural(ch.length, 'file')} changed <span className="num" style={{ color: 'var(--success-fg)' }}>+{add}</span> <span className="num" style={{ color: 'var(--danger-fg)' }}>−{del}</span></>, 'changes'])
  if (qs.length) rows.push(['db', 'k-db', <>{plural(qs.length, 'query', 'queries')} on {conns.join(', ')}{qs.some(q => q.status === 'pending') && !S.resolved.ap_sql ? <span className="attn-t"> · 1 write waiting</span> : null}</>, 'queries'])
  if (rq.length) rows.push(['net', 'k-net', <>{plural(rq.length, 'request')}{rq.some(r => r.blocked) ? <span className="dz-t"> · 1 blocked by policy</span> : null}</>, 'requests'])
  if (cs.length) rows.push(['box', 'k-box', <>{plural(cs.length, 'container')}: {cs.map(c => c.name).join(', ')}</>, 'containers'])
  return <>
    <section><h4 className="slabel">What it touched</h4>{rows.length ? <div className="touch">{rows.map(([i, k, txt, v]) => <button key={v} onClick={tab(v)}><span className={k}><Icon n={i} s={12} /></span><span>{txt}</span><Icon n="right" s={12} /></button>)}</div> : <p className="muted" style={{ fontSize: 12 }}>Nothing yet. It has only read files so far.</p>}</section>
    {cks.length ? <section><h4 className="slabel">Checkpoints</h4><div className="hist">{cks.map(c => { const now = past == null ? c.n === cks.length - 1 : past === c.n
      return <div key={c.n} className={(now ? 'now' : '') + (past != null && c.n > past ? ' fut' : '')}><i /><span className="trunc">{c.label}<br /><small>{c.at}</small></span>
        <span className="acts"><button className="ibtn sm" onClick={run(() => { S.past[t.id] = c.n; S.tab = 'conv'; syncScreen() })} title="View this moment" aria-label={`View checkpoint ${c.n}`}><Icon n="eye" s={12} /></button><button className="ibtn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'restore', ck: c.n } })} title="Restore files" aria-label={`Restore files to checkpoint ${c.n}`}><Icon n="undo" s={12} /></button><button className="ibtn sm" onClick={run(() => { S.overlay = { type: 'dlg', id: 'branch', ck: c.n } })} title="Branch from here" aria-label={`Branch from checkpoint ${c.n}`}><Icon n="fork" s={12} /></button></span></div> })}</div>
      {past != null ? <button className="btn sm" onClick={run(() => { delete S.past[t.id] })}>Back to now</button> : null}</section> : null}
    {pr ? <section><h4 className="slabel">Pull request</h4><button className="prc" onClick={tab('pr')} style={{ textAlign: 'left' }}><div className="row"><Icon n="pr" s={12} /><b>#{pr.n}</b><span className="trunc">{pr.title}</span></div><div className="row"><span className={'pill ' + (pr.state === 'merged' ? 'done' : 'run')}>{pr.state === 'merged' ? 'Merged' : 'Open'}</span><span className="muted">{pr.checks.filter(c => c[1] === 'pass').length} of {pr.checks.length} checks passed</span></div></button></section> : null}</>
}
function Details ({ t }: { t: Task }) {
  const c = cmpState(t); const acc = ACCESS[c.access]; const pct = t.ctx[0]; const used = +t.ctx[1].replace('k', '')
  const Sec = ({ id, title, sum, children }: { id: string; title: string; sum: React.ReactNode; children: React.ReactNode }) => <div className="disc"><button onClick={run(() => { S.disc[id] = !S.disc[id] })} aria-expanded={!!S.disc[id]} aria-controls={'disc-' + id}><span className="chev"><Icon n="right" s={12} /></span>{title}<small>{sum}</small></button>{S.disc[id] ? <div id={'disc-' + id} role="region">{children}</div> : null}</div>
  const files = D.changes[t.id] || []
  return <><div className="cd-sum"><div className="row"><Av p={t.prov} /><button className="chp" onClick={menuBtn('model', true)}><span className={'pdot ' + t.prov} /><span>{c.model}</span></button><button className={'chp ' + acc[2]} onClick={menuBtn('access', true)}><Icon n={acc[0]} s={12} /><span>{acc[1]}</span></button></div>
    <div className="row mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}><Icon n="branch" s={12} /><span className="trunc">{t.branch}</span>{t.worktree ? <span className="wt">own worktree</span> : null}</div>
    <div className={'meter' + (pct >= 80 ? ' warn' : '')}><i style={{ width: pct + '%' }} /></div><div className="row" style={{ fontSize: 11, color: 'var(--text-muted)' }}><span>Context</span><span className="sp" /><span className="num">{pct}% · {t.ctx[1]} / {t.ctx[2]}</span></div></div>
    <Sec id="env" title="Environment" sum={`${D.projects[t.project].branch} · ${t.worktree ? 'own worktree' : 'main checkout'}`}><dl className="dl"><div><dt>Project</dt><dd>{D.projects[t.project].name}</dd></div><div><dt>Provider</dt><dd>{prov(t.prov).name}</dd></div><div><dt>Worktree</dt><dd className="mono" title={`~/.oxespace/worktrees/${D.projects[t.project].name}/${t.id}`}>~/.oxespace/…/{t.id}</dd></div><div><dt>Base</dt><dd className="mono">main @ 9bb5339</dd></div><div><dt>Shell</dt><dd>bash 5.2</dd></div><div><dt>Node</dt><dd>22.11.0</dd></div></dl></Sec>
    <Sec id="ctx" title="Context" sum={`Messages ${Math.round(pct * 0.48)}%`}>{([['Messages', 'var(--accent)', 48], ['Tools', 'var(--info)', 27], ['MCP', 'var(--warning)', 11], ['System', 'var(--border-strong)', 9], ['Skills', 'var(--success)', 5]] as const).map(([n, col, p]) => <div key={n} className="bk"><i style={{ background: col }} /><span>{n}</span><span className="bar"><b style={{ width: p + '%', background: col }} /></span><span>{Math.round(used * p / 100)}k</span></div>)}
      <div className="bk"><i /><span className="muted">Free</span><span /><span>{200 - used}k</span></div><button className="btn sm" style={{ justifySelf: 'start' }} onClick={run(() => toast('/compact sent. The agent summarizes older turns.'))}>Compact now</button></Sec>
    <Sec id="tools" title="Tools" sum={<>23 calls · <span style={{ color: 'var(--danger-fg)' }}>1 failed</span></>}>{([['Read', 9], ['Shell', 6], ['Edit', 4], ['Query', 3], ['Search', 1]] as const).map(([n, k]) => <div key={n} className="row"><span>{n}</span><span className="sp" /><span className="num muted">{k}</span></div>)}
      <div className="row" style={{ color: 'var(--danger-fg)' }}><Icon n="warn" s={12} />npm run lint<span className="sp" /><span className="num">1 failed</span></div><div className="slabel" style={{ marginTop: 4 }}>MCP servers</div><div className="chips">{D.mcp.filter(m => m.status !== 'off').map(m => <span key={m.name} className="chip" style={{ height: 24 }}><span className={'sdot ' + (m.status === 'ok' ? 'on' : 'bad')} />{m.name}</span>)}</div></Sec>
    <Sec id="out" title="Outputs" sum={plural(files.length, 'file')}>{files.length ? files.map(f => <div key={f.path} className="row mono" style={{ fontSize: 11 }}><span className="trunc">{f.path}</span><span className="sp" /><span style={{ color: 'var(--success-fg)' }}>+{f.add}</span><span style={{ color: 'var(--danger-fg)' }}>−{f.del}</span></div>) : <span className="muted">No files changed.</span>}</Sec>
    <Sec id="bg" title="Background" sum={t.id === 't142' ? <><span className="dot pulse" style={{ color: 'var(--accent)' }} />2 running</> : 'None'}>{t.id === 't142' ? <><div className="row"><span className="spin" />npm test -- charges<span className="sp" /><span className="num muted">1:12</span></div><div className="row"><span className="spin" />tsc --watch<span className="sp" /><span className="num muted">44 min</span></div></> : <span className="muted">Nothing running in the background.</span>}</Sec></>
}

/* ---------------------------------------------------------------- side chat (T58 §7c, T60) */
const SC_ANS: Record<string, string> = { t143: 'Staging still has 1,284 March invoices marked <code>open</code> although their charges settled, so the report counts them as unpaid. Codex wants staging to match production before comparing totals. The report fix itself doesn\'t need the update.' }
function scAsk (t: Task, text?: string) {
  const s = scState(t); const q = (text ?? s.draft).trim(); if (!q) return
  s.msgs.push({ q }, { busy: true }); s.draft = ''
  setTimeout(() => { s.msgs = s.msgs.filter(m => !m.busy); s.msgs.push({ a: SC_ANS[t.id] && /why|update/i.test(q) ? SC_ANS[t.id] : `So far: ${(D.changes[t.id] || []).map(f => '<code>' + f.path + '</code>').join(', ') || 'no files changed'}. The agent is on "${t.now}".` }); emit() }, 1400)
}
function SideChatPanel ({ t }: { t: Task }) {
  const s = scState(t); const sc: Cmp = { mode: 'agent', model: s.model, effort: s.effort, access: 'read', pend: {} }
  return <aside className="scd" aria-label="Side chat" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); document.getElementById('cmp-' + t.id)?.focus() } }}>
    <div className="scd-h"><span className="ti"><Icon n="copy" /></span><b>Side chat</b><span className="muted">·</span><span className="trunc muted" style={{ fontSize: 12 }}>Copy of "{t.title}"</span><span className="sp" /><span className="num muted" style={{ fontSize: 11 }}>{money(0.01 * s.msgs.filter(m => m.a).length)}</span>
      <button className="ibtn sm" onClick={menuBtn('scmenu')} aria-label="Side chat actions"><Icon n="more" s={12} /></button><button className="ibtn sm" onClick={run(() => { s.open = false; syncScreen() })} title="Close (Ctrl .). Keeps the copy." aria-label="Close side chat"><Icon n="x" s={12} /></button></div>
    <div className="scd-b" ref={pinBottom}>{s.msgs.length ? s.msgs.map((m, i) => m.q ? <div key={i} className="m-you" style={{ maxWidth: '88%' }}>{m.q}</div> : m.busy ? <div key={i} className="turn" style={{ marginLeft: 0 }}><span className="dot pulse" />Answering: reading the conversation…</div>
      : <div key={i} className="m-ag" style={{ gridTemplateColumns: '16px minmax(0,1fr)' }}><Av p={t.prov} size="s16" /><Html as="div" className="body" html={m.a || ''} /><div className="hov"><button className="ibtn sm" onClick={run(() => toast('Copied to the clipboard'))} aria-label="Copy answer"><Icon n="copy" s={12} /></button></div></div>)
      : <div className="empty"><span style={{ color: 'var(--text-accent)' }}><Icon n="copy" s={16} /></span><h3>Ask about this conversation</h3><p style={{ fontSize: 12 }}>Answers come from a copy. Nothing you ask here reaches the conversation or changes your files.</p>
        <div className="stack" style={{ width: '100%' }}><button className="btn sm" onClick={run(() => scAsk(t, t.id === 't143' ? 'Why does Codex want to update the invoices?' : 'Why is it waiting?'))}>{t.id === 't143' ? 'Why does it want to update the invoices?' : 'Why is it waiting?'}</button><button className="btn sm" onClick={run(() => scAsk(t, 'Summarize what changed so far'))}>Summarize what changed so far</button></div></div>}</div>
    <div className="cmp-wrap"><div className="cmp"><textarea id={'sc-' + t.id} rows={2} placeholder="Ask about this conversation…" aria-label="Ask the side chat" value={s.draft} onChange={e => { s.draft = e.target.value; emit() }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); scAsk(t); emit() } }} />
      <div className="strip"><Chips t={t} c={sc} side /><span className="sp" /><button className="send" disabled={!s.draft.trim()} onClick={run(() => scAsk(t))} aria-label="Ask"><Icon n="up" /></button></div></div></div></aside>
}
MENUS.scmenu = () => { const t = cur(), s = scState(t); return <><MI icon="copy" label="Copy all answers" onClick={() => toast('Copied every answer')} /><hr /><MI icon="trash" dz label="Discard and close…" onClick={() => { if (s.msgs.some(m => m.a)) S.overlay = { type: 'dlg', id: 'scdiscard' }; else { s.open = false; s.msgs = [] } }} /></> }

export { raisePush, goScreen, task }

/** An edit row, expanded: the file's diff and the checkout it was written in, so it opens from the right place. */
function EditDetail ({ tid, path }: { tid: string; path: string }) {
  const t = task(tid); const places = t ? placesFor(t) : []
  const pl = places.find(p => p.files.some(f => f.path === path)) || places[0]
  const f = pl?.files.find(x => x.path === path)
  return <div className="trd edit-d">{f ? <DiffFile f={f} /> : <p className="muted">The diff for this edit is in the checkpoint.</p>}
    <div className="row" style={{ fontFamily: 'var(--f-ui)', fontSize: 12 }}><Icon n={pl?.kind === 'outside' ? 'folder' : 'branch'} s={12} /><span className="muted">Written in</span><span className="mono trunc">{pl?.path}{pl?.branch ? ` · ${pl.branch}` : ''}</span><span className="sp" />
      <button className="btn sm" onClick={run(() => toast(`Opened ${path} from ${pl?.path}`))}>Open file</button><button className="btn sm" onClick={run(() => { S.tab = 'changes'; syncScreen() })}>All changes</button></div></div>
}

const VERB_KIND: Record<string, string> = { Read: 'read', Search: 'read', Fetch: 'read', MCP: 'read', Create: 'edit', Edit: 'edit', Shell: 'run', Query: 'run', Request: 'run', Container: 'run' }
/** Consecutive tool calls fold into one line ("6 steps: …"). The latest group stays open while it runs. */
function ToolGroup ({ t, rows, k }: { t: Task; rows: ToolRow[]; k: string }) {
  const running = rows.some(r => r[5]); const open = S.open[k] ?? (running || S.verbose)
  const n = (kind: string) => rows.filter(r => VERB_KIND[r[1]] === kind || (kind === 'run' && r[0] === 'fail' && VERB_KIND[r[1]] === 'run')).length
  const files = new Set(rows.filter(r => VERB_KIND[r[1]] === 'edit').map(r => r[2])).size
  const failed = rows.filter(r => r[0] === 'fail').length; const fixed = failed && rows.slice(rows.findIndex(r => r[0] === 'fail') + 1).some(r => r[0] !== 'fail' && r[1] === rows.find(x => x[0] === 'fail')![1])
  const parts = [n('read') ? `read ${plural(n('read'), 'thing')}` : '', files ? `edited ${plural(files, 'file')}` : '', n('run') ? `ran ${plural(n('run'), 'command')}` : ''].filter(Boolean)
  return <div className="tgroup"><button className="tg-sum" aria-expanded={open} onClick={run(() => { S.open[k] = !open })}>
    {running ? <span className="spin" /> : <Icon n={open ? 'down' : 'right'} s={12} />}<span>{running ? rows.find(r => r[5])![2] : `${plural(rows.length, 'step')}: ${parts.join(', ')}`}</span>
    {failed ? <span className={fixed ? 'muted' : 'dz-t'}>· {fixed ? `${failed} error, fixed` : `${failed} failed`}</span> : null}</button>
    {open ? <div className="trs">{rows.map((r, j) => <ToolRowView key={j} r={r} k={`${k}:${j}`} />)}</div> : null}</div>
}
