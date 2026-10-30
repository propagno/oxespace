import { useMemo, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GitDiffHunk, GitDiffLine } from '../../../shared/types/git'
import { TextArea } from '../../ui'

export function ThreadPatch({ hunks, onComment }: { hunks: GitDiffHunk[]; onComment?(line: GitDiffLine, body: string): void }) {
  const { t } = useTranslation('thread')
  const [limit, setLimit] = useState(600), [anchor, setAnchor] = useState<GitDiffLine | null>(null), [body, setBody] = useState('')
  const rows = useMemo(() => hunks.flatMap(hunk => [{ header: hunk.header }, ...hunk.lines.map(line => ({ line }))]), [hunks])
  const lineLabel = (line: GitDiffLine): string => line.newLineNo !== null ? t('patch.commentOnNew', { line: line.newLineNo }) : t('patch.commentOnOld', { line: line.oldLineNo })
  return <><div className="thread-review-diff" role="region" aria-label={t('patch.region')} tabIndex={0}>{rows.slice(0, limit).map((row, index) => 'header' in row ? <div key={index} className="thread-diff-hunk">{row.header}</div> : <div key={index} className={`thread-diff-line is-${row.line.type}`}>
    <span>{row.line.oldLineNo ?? ''}</span><span>{row.line.newLineNo ?? ''}</span><code>{row.line.type === 'added' ? '+' : row.line.type === 'removed' ? '−' : ' '} {row.line.content}</code>{onComment && <button type="button" aria-label={lineLabel(row.line)} title={t('patch.commentTitle')} onClick={() => { setAnchor(row.line); setBody('') }} disabled={row.line.newLineNo === null && row.line.oldLineNo === null}><MessageSquarePlus size={12} /></button>}
  </div>)}</div>{rows.length > limit && <button type="button" onClick={() => setLimit(value => value + 600)}>{t('patch.showMore', { count: rows.length - limit })}</button>}
    {anchor && <form className="thread-review-comment" onSubmit={event => { event.preventDefault(); if (!body.trim()) return; onComment?.(anchor, body.trim()); setAnchor(null); setBody('') }}><label>{lineLabel(anchor)}<TextArea aria-label={t('patch.commentLabel')} value={body} maxLength={8000} onChange={event => setBody(event.target.value)} autoFocus /></label><div><button type="button" onClick={() => setAnchor(null)}>{t('common.cancel')}</button><button type="submit" disabled={!body.trim()}>{t('patch.add')}</button></div></form>}
  </>
}
