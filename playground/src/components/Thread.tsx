/* The richer parts of an OxeChat thread (T58, plus what Claude Code and Codex desktop show): thinking, todos,
   subagents, plans, command and edit approvals, background shells, retries, compaction, interactive questions. */
import { useState } from 'react'
import type { ConvItem, Task } from '../mock/types'
import { QUESTIONS } from '../mock/thread'
import { S, emit, run, toast } from '../state/store'
import { Icon, Kbd } from './ui'
import { ToolRowView } from './Task'
import { CodeBlock, Hl } from './Code'

export const isRich = (it: ConvItem) => !!(it.think || it.todos || it.sub || it.plan || it.cmd || it.edit || it.bg || it.retry || it.compact || it.ask || it.answered || it.summary)

export function RichItem ({ t, it, i }: { t: Task; it: ConvItem; i: number }) {
  const k = `${t.id}:${i}`
  if (it.think) { const open = !!S.open[k]
    return <div className="rich"><button className="think" aria-expanded={open} onClick={run(() => { S.open[k] = !open })}><Icon n="sparkle" s={12} />Thought for {it.think[0]} s<Icon n={open ? 'down' : 'right'} s={12} /></button>{open ? <p className="think-b">{it.think[1]}</p> : null}</div> }
  if (it.todos) { const done = it.todos.filter(x => x[0] === 'done').length
    return <div className="rich card todo"><div className="card-h"><Icon n="list" s={12} /><b>Todos</b><span className="muted">{done} of {it.todos.length} done</span><span className="bar"><i style={{ width: `${done / it.todos.length * 100}%` }} /></span></div>
      <ul>{it.todos.map(([st, txt]) => <li key={txt} className={st}><span className="tick">{st === 'done' ? <Icon n="check" s={12} /> : st === 'run' ? <span className="spin" /> : null}</span>{txt}</li>)}</ul></div> }
  if (it.sub) { const s = it.sub; const open = S.open[k] ?? false
    return <div className="rich card sub"><button className="card-h" aria-expanded={open} onClick={run(() => { S.open[k] = !open })}><span className="subico"><Icon n="users" s={12} /></span><b>{s.name} agent</b><span className="trunc">{s.task}</span><span className="sp" /><span className="muted num">{s.rows.length} tools · {s.secs} s</span><Icon n={open ? 'down' : 'right'} s={12} /></button>
      {open ? <div className="trs" style={{ marginLeft: 8 }}>{s.rows.map((r, j) => <ToolRowView key={j} r={r} k={k + 's' + j} still />)}</div> : null}<p className="sub-r"><Icon n="check" s={12} />{s.result}</p></div> }
  if (it.plan) { const p = it.plan
    return <div className={'rich card plan' + (p.state === 'pending' ? ' attn' : '')}><div className="card-h"><Icon n="list" s={12} /><b>Plan</b><span className="sp" />{p.state === 'approved' ? <span className="res ok">You approved it · {p.at}</span> : null}</div>
      <ol>{p.steps.map(s => <li key={s}>{s}</li>)}</ol>
      {p.state === 'pending' ? <div className="row"><button className="btn sm">Keep planning</button><button className="btn sm pri">Approve the plan</button></div> : null}</div> }
  if (it.cmd) return <CmdCard t={t} it={it} />
  if (it.edit) { const e = it.edit; const open = S.open[k] ?? true
    return <div className="rich card"><button className="card-h" aria-expanded={open} onClick={run(() => { S.open[k] = !open })}><Icon n="pencil" s={12} /><b>Edit</b><span className="mono trunc">{e.path}</span><span className="sp" /><span className="res ok">You allowed it · {e.at}</span><Icon n={open ? 'down' : 'right'} s={12} /></button>
      {open ? <pre className="cblk-b diffb"><Hl s={e.diff} lang="diff" /></pre> : null}</div> }
  if (it.bg) { const b = it.bg; const st = S.bgState?.[b.id] || 'running'; const open = !!S.open[k]
    return <div className="rich card bgc"><div className="card-h"><span className={'live ' + st} /><b>{st === 'running' ? 'Running in the background' : 'Stopped'}</b><span className="mono">{b.cmd}</span><span className="sp" /><span className="muted num">since {b.started}</span>
      <button className="btn sm" onClick={run(() => { S.open[k] = !open })}>{open ? 'Hide output' : 'Show output'}</button>{st === 'running' ? <button className="btn sm" onClick={run(() => { (S.bgState ||= {})[b.id] = 'stopped'; toast(`Stopped ${b.cmd}`) })}><Icon n="stop" s={12} />Stop</button> : null}</div>
      <pre className="bg-out">{(open ? b.lines : b.lines.slice(-2)).join('\n')}</pre></div> }
  if (it.retry) return <div className="rich note warn"><Icon n="refresh" s={12} />{it.retry}</div>
  if (it.compact) return <div className="rich note"><Icon n="layers" s={12} />{it.compact}</div>
  if (it.answered) return <div className="rich card"><div className="card-h"><Icon n="check" s={12} /><b>You answered</b></div><dl className="ans">{it.answered.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl></div>
  if (it.summary) return <div className="rich card sum"><div className="card-h"><Icon n="check" s={12} /><b>Done</b><span className="muted">{it.summary.files.length} files · tests pass</span></div><p>{it.summary.text}</p>
    <ul className="files">{it.summary.files.map(([f, a, d]) => <li key={f}><span className="mono">{f}</span><span className="sp" /><span className="num" style={{ color: 'var(--success-fg)' }}>+{a}</span><span className="num" style={{ color: 'var(--danger-fg)' }}>−{d}</span></li>)}</ul>
    <div className="row"><button className="btn sm" onClick={run(() => { S.tab = 'changes' })}>Review changes</button><button className="btn sm pri" onClick={run(() => { S.tab = 'pr' })}><Icon n="pr" s={12} />Open a pull request</button></div></div>
  if (it.ask) return <Question t={t} id={it.ask} />
  return null
}

/** A command the agent wants to run. Deny is the default; "Always allow" is scoped and shown in Settings. */
function CmdCard ({ t, it }: { t: Task; it: ConvItem }) {
  const c = it.cmd!
  if (c.state !== 'pending') return <div className="rich note"><Icon n="shell" s={12} /><span><span className="mono">{c.cmd}</span> · {c.state === 'always' ? `you allowed Bash(${c.cmd.split(' ').slice(0, 2).join(' ')}:*) in this project` : c.state === 'deny' ? 'you denied it' : 'you allowed it once'} · {c.at}</span></div>
  const decide = (how: string) => run(() => decideCmd(t, how))
  const risky = /^(git push|curl|wget|rm |docker (compose )?down|psql|npm publish)/.test(c.cmd)
  const rule = risky ? null : t.prov === 'claude' ? `Bash(${c.cmd.split(' ').slice(0, 2).join(' ')}:*) in this project` : 'for this session'
  return <div className="rich card attn ask" role="region" aria-label="Command waiting for your approval" id={'ask-' + t.id}>
    <div className="card-h"><span className="sun live" /><b>Claude wants to run a command</b></div>
    <pre className="cblk-b cmdl"><span className="tk-pun">$ </span><Hl s={c.cmd} lang="shell" /></pre>
    <p className="muted" style={{ fontSize: 12 }}>{c.why} · in <span className="mono">{c.cwd}</span></p>
    <div className="row"><button className="btn" autoFocus onClick={decide('deny')}>Deny <Kbd>D</Kbd></button><span className="sp" />{rule ? <button className="btn" title={t.prov === 'claude' ? 'Claude Code\'s project permission rule, saved in .claude/settings.local.json' : 'Codex allows it until this session ends'} onClick={decide('always')}>Always allow <span className="mono">{rule}</span></button> : <span className="muted" style={{ fontSize: 12 }}>Always allow isn't offered for commands that push, delete or use the network.</span>}<button className="btn pri" onClick={decide('once')}>Allow once <kbd className="k">A</kbd></button></div></div>
}

/** AskUserQuestion: one question per page, the pager in the footer (C-02), Answer enabled once each has a choice. */
function Question ({ t, id }: { t: Task; id: string }) {
  const qs = QUESTIONS[id as 'q147']; const [page, setPage] = useState(0)
  const ans = (S.answers ||= {}); const cur = qs[page]; const key = (n: number) => `${id}:${n}`
  const picked = (n: number) => ans[key(n)] || []
  const ready = qs.every((_, n) => picked(n).length > 0)
  const toggle = (label: string) => run(() => { const a = picked(page); ans[key(page)] = cur.multi ? (a.includes(label) ? a.filter(x => x !== label) : a.concat(label)) : [label] })
  const submit = run(() => {
    const conv = S.conv[t.id]; const idx = conv.findIndex(x => x.ask === id)
    conv.splice(idx, 1, { answered: qs.map((q, n) => [q.q, picked(n).join(', ')]) })
    t.ask = null; t.status = 'run'; t.now = 'Writing the refund tests'; S.running[t.id] = 0
    setTimeout(() => { conv.push({ tools: [['edit', 'Create', 'test/refunds/create.test.ts', '+88'], ['edit', 'Edit', 'src/refunds/create.ts', '+4 −1']] }, { cmd: { cmd: 'npm test -- refunds', cwd: 'cajui-api (worktree)', why: 'Run the new refund tests.', state: 'pending', at: '' } }); t.status = 'needs'; t.ask = 'cmd'; t.now = 'Waiting for you: run npm test -- refunds'; emit() }, 1800)
  })
  return <div className="rich card attn ask q" role="region" aria-label="Claude has questions for you" id={'ask-' + t.id}>
    <div className="card-h"><span className="sun live" /><b>Claude needs your input</b><span className="sp" /><span className="muted">{cur.multi ? 'Pick any' : 'Pick one'}</span></div>
    <p className="qq">{cur.q}</p>
    <div className="opts" role={cur.multi ? 'group' : 'radiogroup'}>{cur.opts.map(([l, h]) => { const on = picked(page).includes(l)
      return <button key={l} className="opt" role={cur.multi ? 'checkbox' : 'radio'} aria-checked={on} onClick={toggle(l)}><span className={'mark' + (cur.multi ? ' sq' : '')}>{on ? <Icon n="check" s={12} /> : null}</span><span><b>{l}</b><small>{h}</small></span></button> })}
      <label className="opt other"><span className={'mark' + (cur.multi ? ' sq' : '')} /><input placeholder="Something else…" aria-label="Another answer" value={ans[key(page) + ':o']?.[0] || ''} onChange={e => { ans[key(page) + ':o'] = [e.target.value]; ans[key(page)] = e.target.value ? [e.target.value] : []; emit() }} /></label></div>
    <div className="row qf"><button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon n="left" s={12} />Previous</button><span className="muted num">{page + 1} of {qs.length}</span><button className="btn sm" disabled={page === qs.length - 1} onClick={() => setPage(page + 1)}>Next<Icon n="right" s={12} /></button><span className="sp" />
      {!ready ? <span className="muted" style={{ fontSize: 12 }}>Answer {qs.length === 1 ? 'the question' : 'both questions'} to continue</span> : null}<button className="btn pri" disabled={!ready} onClick={submit}>Answer</button></div></div>
}

function afterCmd (t: Task, how: string) {
  const conv = S.conv[t.id]
  if (how === 'deny') { t.status = 'review'; t.now = 'Waiting for your next message'; setTimeout(() => { conv.push({ agent: 'Okay, I didn\'t run the tests. The test file is written; run <code>npm test -- refunds</code> yourself, or tell me when I can.', at: '14:58' }); emit() }, 900); return }
  t.status = 'run'; t.now = 'Running the refund tests'; S.running[t.id] = 0
  setTimeout(() => {
    conv.push({ tools: [['run', 'Shell', 'npm test -- refunds', '9 passed · 2.8 s']] }, { todos: [['done', 'Read the PSP refund docs'], ['done', 'Find how charges and settlements are stored'], ['done', 'Design the refunds table and endpoint'], ['done', 'Write the endpoint with validation'], ['done', 'Tests: partial, full, over the limit, after 90 days'], ['todo', 'Open a pull request']] },
      { summary: { text: 'POST /charges/:id/refunds is in. Over-the-limit requests get 422, and merchants are notified on each event you picked. 9 tests pass. The queued note about the audit table is next.', files: [['migrations/0044_refunds.sql', 16, 0], ['src/refunds/create.ts', 75, 1], ['src/charges/routes.ts', 3, 0], ['test/refunds/create.test.ts', 88, 0]] } })
    t.status = 'review'; t.now = 'Ready: 4 files, 9 tests pass'; t.counts.changes = 4; emit()
  }, 2200)
  if (how !== 'deny' && !S.conv[t.id].some(x => x.cmd && x.cmd.cmd.startsWith('git push'))) setTimeout(() => { S.conv[t.id].push({ cmd: { cmd: 'git push -u origin oxe/t147-pix-refunds', cwd: 'cajui-api (worktree)', why: 'Push the branch so I can open a pull request.', state: 'pending', at: '' } }); t.status = 'needs'; t.ask = 'cmd'; t.now = 'Needs you: push oxe/t147-pix-refunds'; emit() }, 3200)
}

/** Decide the pending command (buttons, the now line, or the D / A keys). */
export function decideCmd (t: Task, how: string) {
  const it = [...S.conv[t.id]].reverse().find(x => x.cmd && x.cmd.state === 'pending'); if (!it) return
  it.cmd!.state = how; it.cmd!.at = '14:58'; t.ask = null; afterCmd(t, how)
}
