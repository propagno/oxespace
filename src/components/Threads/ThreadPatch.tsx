import { useMemo, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import type { GitDiffHunk, GitDiffLine } from '../../../shared/types/git'

export function ThreadPatch({ hunks, onComment }: { hunks: GitDiffHunk[]; onComment?(line: GitDiffLine, body: string): void }) {
  const [limit, setLimit] = useState(600), [anchor, setAnchor] = useState<GitDiffLine | null>(null), [body, setBody] = useState('')
  const rows = useMemo(() => hunks.flatMap(hunk => [{ header: hunk.header }, ...hunk.lines.map(line => ({ line }))]), [hunks])
  return <><div className="thread-review-diff" role="region" aria-label="File diff" tabIndex={0}>{rows.slice(0, limit).map((row, index) => 'header' in row ? <div key={index} className="thread-diff-hunk">{row.header}</div> : <div key={index} className={`thread-diff-line is-${row.line.type}`}>
    <span>{row.line.oldLineNo ?? ''}</span><span>{row.line.newLineNo ?? ''}</span><code>{row.line.type === 'added' ? '+' : row.line.type === 'removed' ? '−' : ' '} {row.line.content}</code>{onComment && <button type="button" aria-label={`Comment on ${row.line.newLineNo !== null ? 'new' : 'old'} line ${row.line.newLineNo ?? row.line.oldLineNo}`} title="Comment on line" onClick={() => { setAnchor(row.line); setBody('') }} disabled={row.line.newLineNo === null && row.line.oldLineNo === null}><MessageSquarePlus size={12} /></button>}
  </div>)}</div>{rows.length > limit && <button type="button" onClick={() => setLimit(value => value + 600)}>Show more lines ({rows.length - limit} remaining)</button>}
    {anchor && <form className="thread-review-comment" onSubmit={event => { event.preventDefault(); if (!body.trim()) return; onComment?.(anchor, body.trim()); setAnchor(null); setBody('') }}><label>Comment on {anchor.newLineNo !== null ? 'new' : 'old'} line {anchor.newLineNo ?? anchor.oldLineNo}<textarea aria-label="Review comment" value={body} maxLength={8000} onChange={event => setBody(event.target.value)} autoFocus /></label><div><button type="button" onClick={() => setAnchor(null)}>Cancel</button><button type="submit" disabled={!body.trim()}>Add to conversation</button></div></form>}
  </>
}
