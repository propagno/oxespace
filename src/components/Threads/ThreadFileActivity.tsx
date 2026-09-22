import { FileCode2, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { parseThreadPatch } from '../../../shared/threadPatch'
import type { ThreadArtifact } from '../../../shared/types/thread'
import { ThreadPatch } from './ThreadPatch'
import type { ThreadEvent } from '../../../shared/types/thread'
import { changeSummary, threadChanges, turnChanges, threadFileLabel, type ThreadChangeEntry } from './threadChanges'

export function ThreadFileActivity({ event, root, threadId, onOpen }: { event: Extract<ThreadEvent, { type: 'tool' }>; root: string; threadId: string; onOpen(entry: ThreadChangeEntry): void }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  return <div className="thread-file-activity">{threadChanges([event]).map(entry => <div key={entry.key}><div className="thread-file-operation"><button type="button" className="thread-file-entry" onClick={() => onOpen(entry)} title={entry.file.path}>
    <FileCode2 size={14} /><span className="thread-file-verb">{entry.file.state === 'failed' ? 'Failed' : entry.file.state === 'running' ? 'Updating' : entry.file.source === 'tool-input' ? 'Tool completed' : entry.file.source === 'working-tree-observation' ? 'Observed' : entry.file.kind === 'add' ? 'Added' : entry.file.kind === 'delete' ? 'Deleted' : entry.file.kind === 'rename' ? 'Renamed' : 'Edited'}</span>
    <span className="thread-file-path">{threadFileLabel(entry.file.path, root)}</span><FileStats file={entry.file} />
  </button>{entry.file.artifactId && <button type="button" className="thread-file-expand" aria-label={`Expand file diff ${threadFileLabel(entry.file.path, root)}`} aria-expanded={expanded === entry.key} onClick={() => setExpanded(value => value === entry.key ? null : entry.key)}><ChevronRight size={12} /></button>}</div>
    {expanded === entry.key && <ThreadInlineEvidence threadId={threadId} artifactId={entry.file.artifactId!} />}
  </div>)}{event.state === 'failed' && event.output && <p className="thread-file-error" role="alert">{event.output}</p>}</div>
}

function ThreadInlineEvidence({ threadId, artifactId }: { threadId: string; artifactId: string }) {
  const [artifact, setArtifact] = useState<ThreadArtifact | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setArtifact(null); setError('')
    const api = window.oxe?.thread
    if (!api?.artifact) { setError('Restart the updated application to load this diff.'); return }
    void api.artifact(threadId, artifactId).then(value => { if (active) setArtifact(value) }, () => { if (active) setError('Could not load this diff.') })
    return () => { active = false }
  }, [threadId, artifactId, revision])
  const parsed = artifact && artifact.source !== 'tool-input' ? parseThreadPatch(artifact.content) : null
  return <div className="thread-inline-evidence">{error ? <div role="alert">{error}<button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></div> : !artifact ? <p role="status">Loading file evidence…</p> : <>{artifact.truncated && <p>Incomplete evidence; totals are unavailable.</p>}{artifact.source === 'tool-input' && <p>Tool input; this is not a verified disk diff.</p>}{artifact.source === 'working-tree-observation' && <p>Verified working-tree observation; authorship is indeterminate.</p>}{parsed?.hunks.length ? <ThreadPatch hunks={parsed.hunks} /> : <pre>{artifact.content}</pre>}</>}</div>
}
export function FileStats({ file }: { file: ThreadChangeEntry['file'] }) {
  return file.additions !== undefined && file.deletions !== undefined && !file.truncated ? <span className="thread-file-stats"><span>+{file.additions}</span><span>−{file.deletions}</span></span> : null
}
export function ThreadTurnChanges({ events, root, onOpen }: { events: ThreadEvent[]; root: string; onOpen(entry: ThreadChangeEntry): void }) {
  const entries = turnChanges(events), summary = changeSummary(entries)
  if (!entries.length) return events.some(event => event.type === 'turn-diff') ? <p className="thread-turn-timing">No remaining file changes in the provider’s final turn diff.</p> : null
  const files = [...new Map(entries.map(entry => [entry.file.path, entry])).values()]
  return <details className="thread-change-summary" open><summary><FileCode2 size={14} /><strong>{summary.files} {summary.files === 1 ? 'file' : 'files'} reported</strong>{summary.exact ? <FileStats file={{ ...entries[0].file, additions: summary.additions, deletions: summary.deletions }} /> : <small>{summary.operations} {summary.operations === 1 ? 'operation' : 'operations'} · see details</small>}<ChevronRight size={13} /></summary>
    <div>{files.map(entry => <button key={entry.key} type="button" onClick={() => onOpen(entry)} title={entry.file.path}><span className="thread-file-path">{threadFileLabel(entry.file.path, root)}</span>{entries.filter(value => value.file.path === entry.file.path).length === 1 && <FileStats file={entry.file} />}<ChevronRight size={12} /></button>)}</div>
  </details>
}
