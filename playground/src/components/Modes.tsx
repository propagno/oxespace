/* Modes used on their own, with no task: OxeChat (quick chat) and OxeCode. One click from the rail. */
import { D } from '../mock/data'
import type { Term } from '../mock/types'
import { S, emit, run, cur, toast } from '../state/store'
import { Icon, MI, menuBtn, StateBlock } from './ui'
import { MENUS } from './Shell'
import { Conversation } from './Task'
import { TermView } from './Tools'

/* ---------------------------------------------------------------- OxeChat: quick chat, no project */
export function QuickChat () {
  const t = cur()
  if (S.view === 'loading') return <StateBlock kind="loading" />
  if (S.view === 'empty') S.conv.quick = []
  if (S.view === 'error') return <StateBlock kind="error" title="Couldn't reach Claude Code" text="The CLI didn't answer in 10 s. Check that it's signed in under Settings › Agents, then try again." />
  const empty = !(S.conv.quick || []).length
  return <div className="tcol" style={{ gridTemplateRows: 'auto minmax(0,1fr)' }}>
    <header className="th" style={{ paddingBottom: 10 }}><div className="th-top"><span style={{ color: 'var(--accent)' }}><Icon n="chat" s={16} /></span><h1 style={{ fontSize: 18 }}>Quick chat</h1><span className="wt">No project · nothing on disk</span><span className="sp" />
      <button className="btn sm" onClick={run(() => { const first = (S.conv.quick || []).find(x => x.you); S.overlay = { type: 'newtask', text: first ? first.you : '' } })}><Icon n="plus" s={12} />Turn into a task…</button>
      <button className="btn sm ghost" onClick={run(() => { S.conv.quick = []; S.drafts.quick = ''; toast('Started a new quick chat') })}>New chat</button></div>
      <p className="muted" style={{ fontSize: 12 }}>For questions that don't need your code. Read only: the agent can't run commands or open files.</p></header>
    <Conversation t={t} empty={empty ? <div className="state"><span className="ico"><Icon n="chat" s={16} /></span><h3>Ask anything</h3><p>Quick chats aren't tied to a project. Turn one into a task when it needs your code.</p>
      <div className="suggest">{['What’s the Pix rule for refunds after 90 days?', 'Explain idempotency keys in two paragraphs', 'Draft a status update for a delayed release', 'Compare Postgres 16 and 17 for our use'].map(q => <button key={q} onClick={run(() => { S.drafts.quick = q; setTimeout(() => document.getElementById('cmp-quick')?.focus(), 0) })}><b>{q}</b>Fills the message box</button>)}</div></div> : null} /></div>
}

/* ---------------------------------------------------------------- OxeCode */
const WORKTREES: [string, string, string][] = [['cajui-api', 'main', ''], ['cajui-api', 'oxe/t142-idempotent-charges', 'T-142'], ['cajui-api', 'oxe/t143-invoice-report', 'T-143'], ['cajui-api', 'oxe/t144-pix-webhooks', 'T-144'], ['cajui-web', 'main', '']]
const SESSIONS: [string, string, string, string][] = [['claude', 'Opus 5.5', 'Refactor the money helpers', 'Yesterday 18:20'], ['codex', 'GPT-5 Codex', 'Status endpoint rate limit', 'Mon 11:02'], ['claude', 'Sonnet 5.5', 'Why is the settlement job slow?', 'Fri 16:47']]
const CLAUDE_PANE: Term = { id: 'kc', name: 'claude', shell: 'claude', cwd: '~/code/cajui/cajui-web', by: 'you', lines: [['', '╭─ Claude Code ──────────────────────────────╮'], ['', '│ Opus 5.5 · ~/code/cajui/cajui-web           │'], ['', '╰────────────────────────────────────────────╯'], ['', ''], ['', '> Where do we format BRL amounts?'], ['', ''], ['', '● lib/money.ts:12  formatBRL(cents) uses Intl.NumberFormat("pt-BR")'], ['dim', '  Used by 14 components; the statements export has its own copy.']] }
const CANNED: Record<string, string[][]> = {
  'git status': [['', 'On branch oxe/t142-idempotent-charges'], ['', 'Changes not staged for commit:'], ['err', '	modified:   src/charges/create.ts'], ['err', '	modified:   src/charges/idempotency.ts']],
  ls: [['', 'README.md  docker-compose.yml  migrations  package.json  src  test  tsconfig.json']],
  'npm test': [['', ' PASS  test/charges/create.test.ts'], ['', ' PASS  test/charges/create.idempotency.test.ts'], ['ok', 'Tests:       26 passed, 26 total']],
  pwd: [['', '~/.oxespace/worktrees/cajui-api/t142']]
}
function initCode () {
  if (!S.codePanes) S.codePanes = [JSON.parse(JSON.stringify(D.terms.t142[1])), Object.assign(JSON.parse(JSON.stringify(D.terms.t142[0])), { tag: 'T-142' }), JSON.parse(JSON.stringify(D.terms.t143[0])), JSON.parse(JSON.stringify(CLAUDE_PANE))]
  return S.codePanes
}
export function CodeMode () {
  const panes = initCode(); const wt = WORKTREES[S.codeWt ?? 1]
  if (S.view === 'loading') return <StateBlock kind="loading" />
  if (S.view === 'error') return <StateBlock kind="error" title="Couldn't start the terminal" text="bash exited with code 127 at start. Check the shell path under Settings › Terminal." />
  if (S.view === 'empty' || !panes.length) return <div className="pane"><Head wt={wt} n={0} /><StateBlock kind="empty" icon="term" title="No terminals open" text="Open a terminal in a project or a task's worktree. Agent CLIs run here too."><button className="btn pri" onClick={run(addTerm)}><Icon n="plus" s={12} />New terminal</button><button className="btn" onClick={run(addAgent)}><Icon n="sparkle" s={12} />Start Claude Code</button></StateBlock></div>
  const layout = S.codeLayout || 'grid'
  const cols = layout === 'one' ? 1 : panes.length === 1 ? 1 : 2
  const style = layout === 'rows' ? { gridTemplateColumns: 'minmax(0,1fr)', gridAutoRows: 'minmax(0,1fr)' } : { gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridAutoRows: 'minmax(0,1fr)' }
  const shown = layout === 'one' ? [panes[Math.min(S.code.focus, panes.length - 1)]] : panes
  return <div className="mode code">
    <Head wt={wt} n={panes.length} />
      <div className="panes" style={style}>{shown.map(k => { const i = panes.indexOf(k)
        return <div key={k.id + i} className={S.code.focus === i ? 'focus' : ''} onMouseDown={() => { if (S.code.focus !== i) { S.code.focus = i; emit() } }}>
          <div className="th-pane"><Icon n={k.shell === 'claude' || k.shell === 'codex' ? 'sparkle' : 'term'} s={12} /><b>{k.name}</b><span className="mono">{k.cwd}</span>{k.by === 'agent' ? <span className="pill run" style={{ height: 18 }}>agent</span> : null}{(k as Term & { tag?: string }).tag ? <span className="pill neutral" style={{ height: 18 }}>{(k as Term & { tag?: string }).tag}</span> : null}<span className="sp" />
            <span className="muted" style={{ fontSize: 11 }}>{k.by === 'agent' ? 'Running' : 'Idle'}</span><button className="ibtn sm" onClick={e => { S.code.focus = i; menuBtn('codepane')(e) }} aria-label={`Actions for ${k.name}`}><Icon n="more" s={12} /></button></div>
          <div style={{ display: 'grid', gridTemplateRows: 'minmax(0,1fr) auto', minHeight: 0, background: '#0f1411' }}><TermView k={k} />
            {k.by === 'you' && k.shell !== 'claude' ? <input className="mono" aria-label={`Type a command in ${k.name}`} placeholder="Type a command and press Enter" style={{ border: 0, borderTop: '1px solid #26302a', background: '#0f1411', color: '#d7e3da', padding: '6px 12px', font: '12px var(--f-mono)', outline: 'none' }}
              value={S.codeDraft?.[k.id] || ''} onChange={e => { (S.codeDraft ||= {})[k.id] = e.target.value; emit() }}
              onKeyDown={e => { if (e.key !== 'Enter') return; const c = (S.codeDraft?.[k.id] || '').trim(); if (!c) return; k.lines.push(['$ ', c], ...(CANNED[c] || [['dim', `${c.split(' ')[0]}: commands don't run in the playground. Try git status, ls, pwd or npm test.`]])); S.codeDraft![k.id] = ''; emit() }} /> : null}</div></div> })}</div></div>
}
function Head ({ wt, n }: { wt: [string, string, string]; n: number }) {
  return <div className="mode-h"><span style={{ color: 'var(--k-shell)' }}><Icon n="term" s={16} /></span><h2 className="mt">OxeCode</h2><button className="btn sm ghost" onClick={menuBtn('wts')} aria-haspopup="menu"><Icon n="branch" s={12} /><span className="mono">{wt[0]} · {wt[1]}</span><Icon n="down" s={12} /></button><span className="muted" style={{ fontSize: 12 }}>{n === 1 ? '1 pane' : `${n} panes`}</span><span className="sp" /><button className="btn sm" onClick={menuBtn('sessions')} aria-haspopup="menu"><Icon n="history" s={12} />Resume…</button>
    <button className="btn sm" onClick={run(addTerm)}><Icon n="plus" s={12} />Terminal</button><button className="btn sm" onClick={run(addAgent)}><Icon n="sparkle" s={12} />Agent</button><button className="ibtn" onClick={menuBtn('codelayout')} aria-label="Layout" title="Layout"><Icon n="grid" /></button></div>
}
function addTerm () { const p = initCode(); const wt = WORKTREES[S.codeWt ?? 1]; p.push({ id: 'n' + Date.now(), name: 'bash', shell: 'bash', cwd: wt[2] ? `~/.oxespace/worktrees/${wt[0]}/${wt[2].toLowerCase().replace('-', '')}` : `~/code/cajui/${wt[0]}`, by: 'you', lines: [] }); S.code.focus = p.length - 1; S.view = 'live' }
function addAgent () { const p = initCode(); p.push(JSON.parse(JSON.stringify(Object.assign({}, CLAUDE_PANE, { id: 'a' + Date.now(), lines: CLAUDE_PANE.lines.slice(0, 4).concat([['dim', '> Ask Claude Code anything about this project']]) })))); S.code.focus = p.length - 1; S.view = 'live'; toast('Started Claude Code (Opus 5.5) in a new pane') }
MENUS.codelayout = () => { const l = S.codeLayout || 'grid'; return <><div className="mg">Layout</div><MI check={l === 'grid'} label="Grid" hint="Two columns" onClick={() => { S.codeLayout = 'grid' }} /><MI check={l === 'rows'} label="Stacked" hint="One column, every pane" onClick={() => { S.codeLayout = 'rows' }} /><MI check={l === 'one'} label="Focused pane only" onClick={() => { S.codeLayout = 'one' }} /></> }
MENUS.codepane = () => { const p = initCode(); const k = p[S.code.focus]; return <><MI icon="copy" label="Copy output" onClick={() => toast('Copied the output')} /><MI icon="history" label="Clear" onClick={() => { if (k) k.lines = [] }} /><hr /><div className="mg">Output savers</div>
  <MI check label="RTK" hint="Compress command output" /><MI check={false} label="Caveman" hint="Shorter agent replies" /><MI check label="Semantic" hint="Search code by meaning" /><hr />
  <MI icon="x" dz label="Close terminal" dis={k?.by === 'agent'} title={k?.by === 'agent' ? 'An agent is using this terminal; stop the task first' : undefined} onClick={() => { const name = k.name; p.splice(S.code.focus, 1); S.code.focus = Math.max(0, S.code.focus - 1); toast(`Closed ${name}`) }} /></> }
MENUS.wts = () => <><div className="mg">Open terminals in</div>{WORKTREES.map(([p, b, k], i) => <MI key={i} check={(S.codeWt ?? 1) === i} label={`${p} · ${b}`} hint={k ? `Worktree of ${k}` : 'Main checkout'} onClick={() => { S.codeWt = i }} />)}</>
MENUS.sessions = () => { const panes = initCode(); const wt = WORKTREES[S.codeWt ?? 1]; return <><div className="mg">Sessions you can resume</div>{SESSIONS.map(([pv, m, ti, at]) => <MI key={ti} icon={pv === 'claude' ? 'sparkle' : 'term'} label={ti} hint={`${m} · ${at}`} onClick={() => { panes.push({ id: 'r' + panes.length, name: pv, shell: pv, cwd: '~/code/cajui/' + wt[0], by: 'you', lines: [['$ ', `${pv === 'claude' ? 'claude --resume' : 'codex resume'} "${ti}"`], ['dim', `Resumed ${m} session from ${at}. 48 messages loaded.`], ['', '> ']] }); S.code.focus = panes.length - 1; toast(`Resumed "${ti}" in a new pane`) }} />)}</> }
