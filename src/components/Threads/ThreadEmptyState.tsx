import { FolderGit2, GitBranch, Shield, Sparkles } from 'lucide-react'
import type { ReactElement } from 'react'
import type { ConversationThread } from '../../../shared/types/thread'

/** Starters fill the composer; the person reads and sends them, nothing is sent on click. */
export const THREAD_STARTERS: readonly { label: string; prompt: string }[] = [
  { label: 'Tour this project', prompt: 'Give me a tour of this project: how it is organized, its entry points, and how to build and run it.' },
  { label: 'Review my changes', prompt: 'Review my uncommitted changes and point out risks or anything I missed.' },
  { label: 'Find likely bugs', prompt: 'Find the parts of this code most likely to have bugs, and explain why for each.' },
  { label: 'Suggest next steps', prompt: 'Suggest the three improvements most worth making here next, with where each would change.' }
]

const ACCESS_LABEL: Record<NonNullable<ConversationThread['access']>, string> = {
  'read-only': 'Read only',
  'workspace-write': 'Can edit this project',
  'full-access': 'Full access'
}

/** The opening of a conversation with no messages yet: where the agent will work, and ways to begin. */
export function ThreadEmptyState({ thread, branch, onStarter }: { thread: ConversationThread; branch?: string | null; onStarter: (prompt: string) => void }): ReactElement {
  const agent = thread.provider === 'claude' ? 'Claude' : 'Codex'
  const folder = thread.rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? thread.rootPath
  return <section className="thread-empty" aria-label="Start the conversation" data-testid="thread-empty">
    <h2>What should {agent} work on in {folder}?</h2>
    <ul className="thread-empty-context" aria-label="Where the agent works">
      <li title={thread.rootPath}><FolderGit2 size={13} aria-hidden="true" />{folder}</li>
      {branch && <li><GitBranch size={13} aria-hidden="true" />{branch}</li>}
      <li><Shield size={13} aria-hidden="true" />{ACCESS_LABEL[thread.access ?? 'read-only']}</li>
      {thread.model && <li><Sparkles size={13} aria-hidden="true" />{thread.model}</li>}
    </ul>
    <div className="thread-empty-starters" role="group" aria-label="Starters">
      {THREAD_STARTERS.map(starter => <button key={starter.label} type="button" className="thread-empty-starter" title={starter.prompt} onClick={() => onStarter(starter.prompt)}>
        <strong>{starter.label}</strong><span>{starter.prompt}</span>
      </button>)}
    </div>
  </section>
}
