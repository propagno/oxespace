/* OxeCode, evolved from 1.4: the workspace sidebar (WorkspaceGroup, PaneSessionRow, sessions to resume), the
   layout presets (Grid/layouts.ts), resizable splits, pane maximize, a branch badge on every pane, and the
   Files / Changes / Browser dock. New in 1.5.0: Focus with tabs, and a warning when a terminal's branch moved. */
import { D } from '../mock/data'
import type { Term } from '../mock/types'
import { S, emit, run, toast } from '../state/store'
import { Icon, MI, menuBtn, StateBlock } from './ui'
import { MENUS } from './Shell'
import { TermView, DiffFile } from './Tools'
import { ToolPanel } from './Workbench'

type CPane = Term & { tag?: string; branch?: string; prov?: string; moved?: string; project?: string }
const LAYOUTS: [string, number, number][] = [['1x1', 1, 1], ['1x2', 1, 2], ['2x1', 2, 1], ['2x2', 2, 2], ['2x3', 2, 3], ['2x4', 2, 4], ['3x4', 3, 4], ['4x4', 4, 4]]
const SESSIONS: [string, string, string, string][] = [['claude', 'Opus 5.5', 'Refactor the money helpers', 'Yesterday 18:20'], ['codex', 'GPT-5 Codex', 'Status endpoint rate limit', 'Mon 11:02'], ['claude', 'Sonnet 5.5', 'Why is the settlement job slow?', 'Fri 16:47']]
const CANNED: Record<string, string[][]> = {
  'git status': [['', 'On branch oxe/t142-idempotent-charges'], ['', 'Changes not staged for commit:'], ['err', '	modified:   src/charges/create.ts'], ['err', '	modified:   src/charges/idempotency.ts']],
  'git branch --show-current': [['', 'oxe/t142-idempotent-charges']], ls: [['', 'README.md  docker-compose.yml  migrations  package.json  src  test']], 'npm test': [['', ' PASS  test/charges/create.test.ts'], ['ok', 'Tests:       26 passed, 26 total']], pwd: [['', '~/.oxespace/worktrees/cajui-api/t142']]
}
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))
function initCode (): CPane[] {
  if (!S.codePanes) S.codePanes = [
    Object.assign(clone(D.terms.t142[1]), { branch: 'oxe/t142-idempotent-charges', project: 'cajui-api' }),
    Object.assign(clone(D.terms.t142[0]), { tag: 'T-142', prov: 'claude', branch: 'oxe/t142-idempotent-charges', project: 'cajui-api' }),
    Object.assign(clone(D.terms.t143[0]), { tag: 'T-143', prov: 'codex', branch: 'mig-prd', moved: 'oxe/t143-invoice-report', project: 'cajui-api' }),
    { id: 'kc', name: 'claude', shell: 'claude', cwd: '~/code/cajui/cajui-web', by: 'you', prov: 'claude', branch: 'main', project: 'cajui-web', lines: [['', '╭─ Claude Code ──────────────────────────────╮'], ['', '│ Opus 5.5 · ~/code/cajui/cajui-web           │'], ['', '╰────────────────────────────────────────────╯'], ['', ''], ['', '> Where do we format BRL amounts?'], ['', ''], ['', '● lib/money.ts:12  formatBRL(cents) uses Intl.NumberFormat("pt-BR")'], ['dim', '  Used by 14 components; the statements export has its own copy.']] }
  ] as CPane[]
  return S.codePanes as CPane[]
}

export function CodeMode () {
  const panes = initCode()
  if (S.view === 'loading') return <StateBlock kind="loading" />
  if (S.view === 'error') return <StateBlock kind="error" title="Couldn't start the terminal" text="bash exited with code 127 at start. Check the shell path in Settings › Terminal." />
  const empty = S.view === 'empty' || !panes.length
  const layout = S.codeLayout && !['grid', 'rows', 'cols', 'one'].includes(S.codeLayout) ? S.codeLayout : '2x2'
  const max = S.codeMax != null && panes[S.codeMax] ? S.codeMax : null
  const focusTabs = layout === 'focus'
  const [rows, cols] = focusTabs ? [1, 1] : (LAYOUTS.find(l => l[0] === layout) || LAYOUTS[3]).slice(1) as [number, number]
  const c = Math.min(cols, S.w === 900 ? 2 : cols)
  const fr = (S.codeFr && S.codeFr.length === c ? S.codeFr : Array(c).fill(1)) as number[]
  const shown = max != null ? [panes[max]] : focusTabs ? [panes[Math.min(S.code.focus, panes.length - 1)]] : panes.slice(0, rows * cols)
  const dock = S.codeDock as string | undefined
  return <div className="mode-split code-split">
    <aside className="mode-side ws-side" aria-label="Workspace"><div className="mside-h"><b>{D.company.name}</b><span className="sp" /><button className="ibtn sm" title="New terminal" aria-label="New terminal" onClick={run(addTerm)}><Icon n="plus" s={12} /></button></div>
      <div className="scroll"><div className="lst">{['cajui-api', 'cajui-web'].map(pr => <div key={pr}><div className="tg"><Icon n="folder" s={12} /><span>{pr}</span><span className="n">{panes.filter(p => (p.project || 'cajui-api') === pr).length}</span></div>
        {panes.map((p, i) => (p.project || 'cajui-api') !== pr ? null : <button key={p.id + i} className="psr" aria-current={S.code.focus === i} onClick={run(() => { S.code.focus = i; if (max != null) S.codeMax = i })}>
          <span className={'sdot ' + (p.by === 'agent' ? 'on' : 'off')} /><span className="psr-n">{p.prov ? <span className={'pdot ' + p.prov} /> : <Icon n="term" s={12} />}<span className="trunc">{p.name}</span>{p.tag ? <span className="mono muted">{p.tag}</span> : null}</span>
          <span className={'bb' + (p.moved ? ' moved' : '')} title={p.moved ? `Was ${p.moved}` : undefined}><Icon n="branch" s={12} /><span className="trunc">{p.branch || 'main'}</span></span></button>)}</div>)}
        <div className="tg"><Icon n="history" s={12} /><span>Sessions you can resume</span></div>{SESSIONS.map(([pv, m, ti, at]) => <div key={ti} className="psr ro"><span className={'pdot ' + pv} /><span className="psr-n"><span className="trunc">{ti}</span></span><button className="btn sm" onClick={run(() => resume(pv, m, ti, at))}>Resume</button><span className="psr-s">{m} · {at}</span></div>)}</div></div>
      <div className="mside-f"><button className="btn sm ghost" onClick={run(() => { S.overlay = { type: 'dlg', id: 'newws' } })}><Icon n="plus" s={12} />New workspace</button></div></aside>
    <div className={'mode code' + (focusTabs && panes.length > 1 && max == null ? ' tabs' : '')}>
      <div className="mode-h"><span style={{ color: 'var(--k-shell)' }}><Icon n="term" s={16} /></span><h2 className="mt">OxeCode</h2><span className="muted" style={{ fontSize: 12 }}>{panes.length === 1 ? '1 pane' : `${panes.length} panes`}</span><span className="sp" />
        <button className="btn sm" onClick={run(addTerm)}><Icon n="plus" s={12} />Terminal</button><button className="btn sm" onClick={run(addAgent)}><Icon n="sparkle" s={12} />Agent</button>
        <button className="btn sm" onClick={menuBtn('codelayout')} aria-haspopup="menu"><Icon n="grid" s={12} />{focusTabs ? 'Focus' : layout.replace('x', ' × ')}</button><span className="vsep" />
        {([['files', 'file', 'Files (Ctrl E)'], ['changes', 'diff', 'Changes (Ctrl Shift D)'], ['browser', 'globe', 'Browser (Ctrl Shift B)']] as const).map(([id, ic, l]) => <button key={id} className="ibtn" aria-pressed={dock === id} title={l} aria-label={l} onClick={run(() => { S.codeDock = dock === id ? undefined : id })}><Icon n={ic} /></button>)}</div>
      {focusTabs && panes.length > 1 && max == null ? <div className="ptabs" role="tablist" aria-label="Terminals">{panes.map((k, i) => <button key={k.id + i} role="tab" aria-selected={S.code.focus === i} onClick={run(() => { S.code.focus = i })}><Icon n={k.prov ? 'sparkle' : 'term'} s={12} />{k.name}{k.by === 'agent' ? <span className="dot" style={{ color: 'var(--accent)' }} /> : null}</button>)}</div> : null}
      <div className="code-body" style={{ gridTemplateColumns: dock ? 'minmax(0,1fr) 440px' : 'minmax(0,1fr)' }}>
        {empty ? <StateBlock kind="empty" icon="term" title="No terminals open" text="Open a terminal in a project or a task's worktree. Agent CLIs run here too."><button className="btn pri" onClick={run(addTerm)}><Icon n="plus" s={12} />New terminal</button><button className="btn" onClick={run(addAgent)}><Icon n="sparkle" s={12} />Start Claude Code</button></StateBlock>
          : <div className="panes rs" style={{ gridTemplateColumns: max != null || focusTabs ? 'minmax(0,1fr)' : fr.map(f => `minmax(0,${f}fr)`).join(' '), gridAutoRows: 'minmax(0,1fr)' }}>
            {shown.map(k => { const i = panes.indexOf(k)
              return <div key={k.id + i} className={S.code.focus === i ? 'focus' : ''} onMouseDown={() => { if (S.code.focus !== i) { S.code.focus = i; emit() } }}>
                <div className="th-pane">{k.prov ? <span className={'pdot ' + k.prov} /> : <Icon n="term" s={12} />}<b>{k.name}</b>{k.tag ? <span className="pill neutral" style={{ height: 18 }}>{k.tag}</span> : null}
                  <span className={'bb' + (k.moved ? ' moved' : '')} title={k.moved ? `This worktree was on ${k.moved}; a terminal switched it` : 'Branch of this pane\'s checkout'}><Icon n="branch" s={12} /><span className="trunc">{k.branch || 'main'}</span>{k.moved ? <Icon n="warn" s={12} /> : null}</span><span className="sp" />
                  <span className="muted" style={{ fontSize: 11 }}>{k.by === 'agent' ? 'Running' : 'Idle'}</span>
                  <button className="ibtn sm" title={max === i ? 'Restore (Ctrl Shift Enter)' : 'Maximize (Ctrl Shift Enter)'} aria-label="Maximize pane" onClick={run(() => { S.codeMax = max === i ? null : i })}><Icon n={max === i ? 'min' : 'max'} s={12} /></button>
                  <button className="ibtn sm" onClick={e => { S.code.focus = i; menuBtn('codepane')(e) }} aria-label={`Actions for ${k.name}`}><Icon n="more" s={12} /></button></div>
                <div style={{ display: 'grid', gridTemplateRows: 'minmax(0,1fr) auto', minHeight: 0, background: '#0f1411' }}><TermView k={k} />
                  {k.by === 'you' && k.shell !== 'claude' ? <input className="mono tin" aria-label={`Type a command in ${k.name}`} placeholder="Type a command and press Enter"
                    value={S.codeDraft?.[k.id] || ''} onChange={e => { (S.codeDraft ||= {})[k.id] = e.target.value; emit() }}
                    onKeyDown={e => { if (e.key !== 'Enter') return; const cmd = (S.codeDraft?.[k.id] || '').trim(); if (!cmd) return; k.lines.push(['$ ', cmd], ...(CANNED[cmd] || [['dim', `${cmd.split(' ')[0]}: commands don't run in the playground. Try git status, ls, pwd or npm test.`]])); S.codeDraft![k.id] = ''; emit() }} /> : null}</div></div> })}
            {max == null && !focusTabs ? fr.slice(0, -1).map((_, j) => <Gutter key={j} j={j} fr={fr} />) : null}</div>}
        {dock ? <aside className="code-dock">{dock === 'changes' ? <div className="scroll"><div className="stack" style={{ padding: 12, gap: 12 }}>{(D.changes.t142 || []).map(f => <DiffFile key={f.path} f={f} />)}</div></div> : <ToolPanel id={dock} t={{ id: 't142', branch: 'oxe/t142-idempotent-charges', project: 'api' }} />}</aside> : null}</div></div></div>
}
/** A drag handle between two columns: resizes them, keeps the total, never below 15%. Arrow keys work too. */
function Gutter ({ j, fr }: { j: number; fr: number[] }) {
  const total = fr.reduce((a, b) => a + b, 0); const left = fr.slice(0, j + 1).reduce((a, b) => a + b, 0) / total * 100
  return <div className="gutter" style={{ left: `calc(${left}% - 3px)` }} role="separator" aria-orientation="vertical" aria-label="Resize panes" tabIndex={0}
    onKeyDown={e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; const f = fr.slice(); const d = e.key === 'ArrowLeft' ? -0.1 : 0.1; if (f[j] + d < 0.3 || f[j + 1] - d < 0.3) return; f[j] += d; f[j + 1] -= d; S.codeFr = f; emit() }}
    onPointerDown={e => { const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect(); const start = fr.slice()
      const move = (ev: PointerEvent) => { const x = (ev.clientX - box.left) / box.width * total; const before = start.slice(0, j).reduce((a, b) => a + b, 0); const pair = start[j] + start[j + 1]; const a = Math.max(0.15 * total, Math.min(pair - 0.15 * total, x - before)); const f = start.slice(); f[j] = a; f[j + 1] = pair - a; S.codeFr = f; emit() }
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up) }} />
}
function resume (pv: string, m: string, ti: string, at: string) { const p = initCode(); p.push({ id: 'r' + p.length, name: pv, shell: pv, prov: pv, cwd: '~/code/cajui/cajui-api', by: 'you', branch: 'main', project: 'cajui-api', lines: [['$ ', `${pv === 'claude' ? 'claude --resume' : 'codex resume'} "${ti}"`], ['dim', `Resumed ${m} session from ${at}. 48 messages loaded.`], ['', '> ']] }); S.code.focus = p.length - 1; toast(`Resumed "${ti}" in a new pane`) }
function addTerm () { const p = initCode(); p.push({ id: 'n' + Date.now(), name: 'bash', shell: 'bash', cwd: '~/code/cajui/cajui-api', by: 'you', branch: 'main', project: 'cajui-api', lines: [] }); S.code.focus = p.length - 1; if (S.view === 'empty') S.view = 'live' }
function addAgent () { const p = initCode(); p.push({ id: 'a' + Date.now(), name: 'claude', shell: 'claude', prov: 'claude', cwd: '~/code/cajui/cajui-api', by: 'you', branch: 'main', project: 'cajui-api', lines: [['', '╭─ Claude Code ──────────────────────────────╮'], ['', '│ Opus 5.5 · ~/code/cajui/cajui-api           │'], ['', '╰────────────────────────────────────────────╯'], ['dim', '> Ask Claude Code anything about this project']] }); S.code.focus = p.length - 1; if (S.view === 'empty') S.view = 'live'; toast('Started Claude Code (Opus 5.5) in a new pane') }
MENUS.codelayout = () => { const l = S.codeLayout || '2x2'; return <><div className="mg">Layout</div>{LAYOUTS.map(([id, r, c]) => <MI key={id} check={l === id} label={`${r} × ${c}`} hint={r * c === 1 ? 'One pane' : `Up to ${r * c} panes`} onClick={() => { S.codeLayout = id; S.codeFr = undefined; S.codeMax = null }} />)}<hr /><MI check={l === 'focus'} label="Focus with tabs" hint="New in 1.5.0: one pane big, the others as tabs" onClick={() => { S.codeLayout = 'focus'; S.codeMax = null }} /></> }
MENUS.codepane = () => { const p = initCode(); const k = p[S.code.focus]; return <><MI icon="copy" label="Copy output" onClick={() => toast('Copied the output')} /><MI icon="history" label="Clear" onClick={() => { if (k) k.lines = [] }} /><MI icon="refresh" label="Restart" sc="Ctrl R" onClick={() => toast(`Restarted ${k?.name}`)} /><MI icon="max" label="Maximize" sc="Ctrl Shift Enter" onClick={() => { S.codeMax = S.code.focus }} /><hr /><div className="mg">Output savers</div>
  <MI check label="RTK" hint="Compress command output" /><MI check={false} label="Caveman" hint="Shorter agent replies" /><MI check label="Semantic" hint="Search code by meaning" /><hr />
  <MI icon="phone" label="Let my phone write here" hint="The paired phone can type in this pane" onClick={() => toast('Your phone can type in this pane until you close it')} /><hr />
  <MI icon="x" dz label="Close terminal" dis={k?.by === 'agent'} title={k?.by === 'agent' ? 'An agent is using this terminal; stop the task first' : undefined} onClick={() => { const name = k.name; p.splice(S.code.focus, 1); S.code.focus = Math.max(0, S.code.focus - 1); toast(`Closed ${name}`) }} /></> }
export function codeMaxToggle () { S.codeMax = S.codeMax != null ? null : S.code.focus }
