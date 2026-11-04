/* T83 · Time travel per conversation. A scrubber over the whole transcript.
   - Files exist only at turn checkpoints: one per user turn, plus one per other checkout touched in that turn
     (BACKEND-2-2). The scrubber snaps files to those; between them it shows the transcript only.
   - Restore follows today's rewind: the later turns are set aside (Redo brings them back until the next message),
     and "Also restore files" puts the files back as they were at that checkpoint.
   - Branch makes a new worktree from that checkpoint's commit and a new conversation up to that point.
   - Databases, requests, containers and pushes can't go back, and the band says so every time. */
import { D } from '../mock/data'
import type { Task, ConvItem } from '../mock/types'
import { S, emit, run, toast, plural } from '../state/store'
import { Icon, Kbd } from './ui'
import type { DialogSpec } from './Overlays'

interface Stop { i: number; at: string; label: string; kind: 'turn' | 'other'; n: number }
interface Ev { i: number; kind: 'db' | 'net' | 'box' | 'push'; what: string }
const first = (s: string) => { const t = s.replace(/<[^>]+>/g, ''); return t.length > 54 ? t.slice(0, 54) + '…' : t }

/** Checkpoints: each user turn, plus the "· in <checkout>" ones the backend records for other checkouts. */
export function stops (t: Task): Stop[] {
  const items = S.conv[t.id] || []; const out: Stop[] = []; let n = 0
  items.forEach((it, i) => { if (it.you) out.push({ i, at: it.at || '', label: first(it.you), kind: 'turn', n: n++ }) })
  for (const c of D.checkpoints[t.id] || []) if (/ · in /.test(c.label)) { const i = items.findIndex(x => (x.at || '') >= c.at && !x.you); out.push({ i: i < 0 ? items.length - 1 : i, at: c.at, label: c.label, kind: 'other', n: n++ }) }
  return out.sort((a, b) => a.i - b.i)
}
/** What already happened outside the files: never undone by a restore. */
export function events (t: Task): Ev[] {
  const out: Ev[] = []
  ;(S.conv[t.id] || []).forEach((it: ConvItem, i) => {
    for (const r of it.tools || []) {
      const v = (r[1] + ' ' + r[2]).toLowerCase()
      if (r[1] === 'Query' || /db:migrate|migrate/.test(v)) out.push({ i, kind: 'db', what: r[1] === 'Query' ? r[2].split(' · ')[0] + ' query' : 'a migration on the local database' })
      else if (/docker|compose|volume/.test(v)) out.push({ i, kind: 'box', what: 'a container change' })
      else if (/curl|request|post \//.test(v) && r[1] !== 'Edit') out.push({ i, kind: 'net', what: 'a network request' })
      else if (/git push/.test(v)) out.push({ i, kind: 'push', what: 'a push' })
    }
    if (it.cmd && /git push/.test(it.cmd.cmd)) out.push({ i, kind: 'push', what: 'a push' })
    if (it.done === 'ap_sql' && it.how !== 'deny') out.push({ i, kind: 'db', what: 'the invoice UPDATE' })
  })
  return out
}
/** Files changed after a point, from the edit rows: what a restore would put back. */
function filesAfter (t: Task, i: number): [string, string][] {
  const m = new Map<string, string>()
  ;(S.conv[t.id] || []).forEach((it, k) => { if (k <= i) return; for (const r of it.tools || []) if (r[0] === 'edit') m.set(r[2], r[3]); if (it.edit) m.set(it.edit.path, 'edited') })
  return [...m]
}
const ICON: Record<Ev['kind'], string> = { db: 'db', net: 'net', box: 'box', push: 'pr' }

export function TimeBar ({ t }: { t: Task }) {
  const items = S.conv[t.id] || []; const st = stops(t); const ev = events(t); const last = items.length - 1
  const at = S.ttAt ?? last
  const snap = [...st].reverse().find(s => s.i <= at)
  const onStop = st.find(s => s.i === at)
  const files = snap ? filesAfter(t, snap.i) : []
  const evAfter = snap ? ev.filter(e => e.i > snap.i) : ev
  const pct = (i: number) => (last ? (i / last) * 100 : 0)
  const set = (i: number) => { S.ttAt = Math.max(0, Math.min(last, i)); emit() }
  const key = (e: React.KeyboardEvent) => {
    const k = e.key; const cur = S.ttAt ?? last
    if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); set(cur + (k === 'ArrowLeft' ? -1 : 1)) }
    if (k === 'PageUp' || k === 'PageDown' || k === '[' || k === ']') { e.preventDefault(); const back = k === 'PageUp' || k === '['; const s = back ? [...st].reverse().find(x => x.i < cur) : st.find(x => x.i > cur); set(s ? s.i : back ? 0 : last) }
    if (k === 'Home') { e.preventDefault(); set(0) } if (k === 'End') { e.preventDefault(); set(last) }
    if (k === 'Escape') { e.preventDefault(); close() }
  }
  const close = () => { S.tt = undefined; S.ttAt = undefined; emit() }
  const now = at === last
  return <section className="ttbar" aria-label="Time travel">
    <div className="tt-top"><Icon n="scrub" s={16} /><b>History</b><span className="muted">{plural(st.length, 'checkpoint')} · {plural(items.length, 'step')}</span><span className="sp" />
      <span className="tt-legend"><span><i className="ttk turn" />your turn: files kept</span><span><i className="ttk other" />other checkout</span><span><i className="ttk ttr" />transcript only</span><span><i className="ttk ev" />can't go back</span></span>
      <button className="ibtn sm" aria-label="Close history (Esc)" title="Close (Esc)" onClick={close}><Icon n="x" s={12} /></button></div>
    <div className="tt-track" role="slider" tabIndex={0} aria-label="Point in the conversation" aria-valuemin={0} aria-valuemax={last} aria-valuenow={at}
      aria-valuetext={now ? 'Now' : onStop ? `Checkpoint ${onStop.at}: ${onStop.label}` : `Step ${at + 1}, transcript only; files as of ${snap?.at || 'the start'}`} onKeyDown={key}
      onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); set(Math.round(((e.clientX - r.left) / r.width) * last)) }}>
      <div className="tt-rail" /><div className="tt-fill" style={{ width: pct(at) + '%' }} />
      {items.map((_, i) => st.some(s => s.i === i) ? null : <i key={'d' + i} className="ttk ttr" style={{ left: pct(i) + '%' }} />)}
      {ev.map((e, k) => <span key={'e' + k} className="tt-ev" style={{ left: pct(e.i) + '%' }} title={`Can't go back: ${e.what}`}><Icon n={ICON[e.kind]} s={12} /></span>)}
      {st.map(s => <button key={'s' + s.i + s.kind} className={'ttk ' + s.kind + (s === snap ? ' on' : '')} style={{ left: pct(s.i) + '%' }} tabIndex={-1} aria-hidden="true" title={`${s.at} · ${s.label}`} onClick={e => { e.stopPropagation(); set(s.i) }}><span className="tt-l">{s.at}</span></button>)}
      <span className="tt-knob" style={{ left: pct(at) + '%' }} /></div>
    <div className="tt-info">
      {now ? <p><b>Now.</b> Drag the knob or use <Kbd>←</Kbd> <Kbd>→</Kbd> for each step, <Kbd>[</Kbd> <Kbd>]</Kbd> for each checkpoint.</p>
        : <p>{onStop ? <><b>Checkpoint {onStop.at}</b> · {onStop.label}</> : <><b>Transcript only.</b> Files are kept at checkpoints; the nearest one before this is <b>{snap?.at || 'the start'}</b>.</>}
          {' '}{files.length ? <>Since then, {plural(files.length, 'file')} changed: <span className="mono">{files.slice(0, 3).map(f => f[0].split('/').pop()).join(', ')}{files.length > 3 ? '…' : ''}</span>.</> : 'No file changed since then.'}</p>}
      {!now ? <div className="row"><button className="btn sm" onClick={run(() => { S.tab = 'changes'; S.changesView = 'turn' })}><Icon n="diff" s={12} />Compare with now</button>
        <button className="btn sm" disabled={!snap} onClick={run(() => { S.overlay = { type: 'dlg', id: 'ttrestore' } })}><Icon n="undo" s={12} />Restore to {snap?.at || 'here'}…</button>
        <button className="btn sm" disabled={!snap} onClick={run(() => { S.overlay = { type: 'dlg', id: 'ttbranch' } })}><Icon n="fork" s={12} />Branch into a new worktree…</button>
        <span className="sp" /><button className="btn sm pri" onClick={run(() => { S.ttAt = undefined })}>Back to now <Kbd>End</Kbd></button></div> : null}
    </div>
    <div className={'callout ' + (evAfter.length && !now ? 'warn' : 'info')} role="note"><Icon n={evAfter.length && !now ? 'warn' : 'info'} />
      <span>{now ? 'Only files go back. ' : ''}<b>Can't go back:</b> {ev.length ? summarize(now ? ev : evAfter) || 'nothing after this point' : 'nothing in this conversation so far'}. Databases, requests, containers and pushes stay as they are; a restore changes files only.</span></div>
  </section>
}
function summarize (ev: Ev[]) {
  const c = (k: Ev['kind']) => ev.filter(e => e.kind === k).length
  return [[c('db'), 'database change'], [c('net'), 'request'], [c('box'), 'container change'], [c('push'), 'push']].filter(([n]) => n).map(([n, l]) => plural(n as number, l as string)).join(', ')
}
function snapOf (t: Task) { const items = S.conv[t.id] || []; const at = S.ttAt ?? items.length - 1; return [...stops(t)].reverse().find(s => s.i <= at) }

export const TT_DIALOGS: Record<string, () => DialogSpec> = {
  ttrestore: () => { const t = S.tasks.find(x => x.id === S.tt)!; const s = snapOf(t)!; const items = S.conv[t.id]; const later = items.slice(s.i).filter(x => x.you).length; const files = filesAfter(t, s.i); const ev = events(t).filter(e => e.i > s.i)
    return { size: 'md', icon: 'undo', title: `Rewind to ${s.at}?`, body: () => <>
      <p style={{ color: 'var(--text-secondary)' }}>Rewinds to before "{s.label}": it and {plural(Math.max(0, later - 1), 'later turn')} are set aside. They leave the conversation, and the provider's history, when you send your next message; until then, Redo brings them back.</p>
      <label className="row" style={{ fontSize: 13 }}><input type="checkbox" checked={S.ttFiles !== false} onChange={e => { S.ttFiles = e.target.checked; emit() }} /> Also restore files changed by those turns <span className="muted">· {plural(files.length, 'file')}</span></label>
      <div className="callout ok"><Icon n="history" /><span>A checkpoint of the files as they are now is made first.</span></div>
      {ev.length ? <div className="callout warn"><Icon n="warn" /><span><b>These stay:</b> {summarize(ev)}. A rewind can't undo them.</span></div> : null}</>,
      primary: { label: 'Rewind', act: () => { const cut = items.splice(s.i); S.ttAt = undefined; S.tt = undefined; toast(`Rewound to ${s.at}${S.ttFiles !== false ? ` · ${plural(files.length, 'file')} restored` : ''}`, { undo: () => { items.push(...cut); emit() } }) } } } },
  ttbranch: () => { const t = S.tasks.find(x => x.id === S.tt)!; const s = snapOf(t)!; const slug = t.branch.replace(/^oxe\//, '').slice(0, 18)
    return { size: 'md', icon: 'fork', title: `Branch from ${s.at}`, body: () => <>
      <p style={{ color: 'var(--text-secondary)' }}>A new worktree starts from the commit of the {s.at} checkpoint, with a new conversation up to that point. "{t.title}" keeps running untouched.</p>
      <div className="field"><label htmlFor="ttb-n">New conversation</label><input className="input" id="ttb-n" defaultValue={t.title + ' (from ' + s.at + ')'} /></div>
      <div className="row"><div className="field" style={{ flex: 1 }}><label htmlFor="ttb-b">Branch</label><input className="input mono" id="ttb-b" defaultValue={`oxe/${slug}-${s.at.replace(':', '')}`} /></div><div className="field" style={{ flex: 1 }}><label htmlFor="ttb-w">Worktree folder</label><input className="input mono" id="ttb-w" defaultValue={`~/.oxespace/worktrees/${D.projects[t.project].name}/${t.id}-${s.at.replace(':', '')}`} /></div></div>
      <div className="callout info"><Icon n="info" /><span>{t.prov === 'codex' ? 'Codex forks its native session at that turn.' : 'Claude Code gets the conversation replayed up to that turn; it takes about 20 s.'} The new worktree shows as its own workspace in OxeCode.</span></div></>,
      primary: { label: 'Create branch', act: () => { S.tt = undefined; S.ttAt = undefined; toast(`Branched from ${s.at} into a new worktree. It shows under ${D.projects[t.project].name}.`) } } } }
}
