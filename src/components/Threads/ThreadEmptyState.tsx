import { FolderGit2, GitBranch, Shield, Sparkles } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConversationThread } from '../../../shared/types/thread'
import { i18n } from '../../i18n'
import { WorktreeCreationNotices } from '../Worktree/WorktreeCreationNotices'

const STARTERS = ['tour', 'review', 'bugs', 'next'] as const

/** A conversation whose worktree notices the person dismissed; a per-window convenience, the notices stay in its data. */
const noticesDismissedKey = (threadId: string): string => `oxe-worktree-notices-dismissed:${threadId}`
function noticesDismissed(threadId: string): boolean {
  try { return localStorage.getItem(noticesDismissedKey(threadId)) === '1' } catch { return false }
}

/**
 * Starters fill the composer; the person reads and sends them, nothing is sent on click. They are written in the
 * interface language, so the agent answers in it too.
 */
export function threadStarters(): { id: (typeof STARTERS)[number]; label: string; prompt: string }[] {
  return STARTERS.map(id => ({ id, label: i18n.t(`thread:opening.starter.${id}.label`), prompt: i18n.t(`thread:opening.starter.${id}.prompt`) }))
}

/**
 * The opening of a conversation with no messages yet: where the agent will work, and ways to begin. A composed
 * welcome rather than an empty-state message, so it keeps its own layout instead of <EmptyState>.
 */
export function ThreadEmptyState({ thread, branch, onStarter }: { thread: ConversationThread; branch?: string | null; onStarter: (prompt: string) => void }): ReactElement {
  const { t } = useTranslation('thread')
  const agent = thread.provider === 'claude' ? 'Claude' : 'Codex'
  const folder = thread.rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? thread.rootPath
  // What creating its worktree reported (the dialog closed as the conversation opened): shown here until dismissed.
  // The dismissal belongs to one conversation: keyed by its id, so a switch without a remount reads the new one's
  // (FRONTEND review #487).
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const dismissed = dismissedId === thread.id || noticesDismissed(thread.id)
  const notices = dismissed ? [] : thread.ownedWorktree?.notices ?? []
  const dismiss = (): void => {
    setDismissedId(thread.id)
    try { localStorage.setItem(noticesDismissedKey(thread.id), '1') } catch { /* this window only, then */ }
  }
  return <section className="thread-opening" aria-label={t('opening.label')} data-testid="thread-empty">
    {/* A worktree of its own is named by its branch in the title: its folder carries a random suffix nobody chose. */}
    <h2>{t('opening.title', { agent, folder: thread.ownedWorktree?.branch ?? folder })}</h2>
    <ul className="thread-opening-context" aria-label={t('opening.context')}>
      <li title={thread.rootPath}><FolderGit2 size={13} aria-hidden="true" />{folder}</li>
      {branch && <li><GitBranch size={13} aria-hidden="true" />{branch}</li>}
      <li><Shield size={13} aria-hidden="true" />{t(`opening.access.${thread.access ?? 'read-only'}`)}</li>
      {thread.model && <li><Sparkles size={13} aria-hidden="true" />{thread.model}</li>}
    </ul>
    <WorktreeCreationNotices notices={notices} onDismiss={dismiss} />
    <div className="thread-opening-starters" role="group" aria-label={t('opening.starters')}>
      {threadStarters().map(starter => <button key={starter.id} type="button" className="thread-opening-starter" title={starter.prompt} onClick={() => onStarter(starter.prompt)}>
        <strong>{starter.label}</strong><span>{starter.prompt}</span>
      </button>)}
    </div>
  </section>
}
