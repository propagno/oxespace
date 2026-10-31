import { FolderGit2, GitBranch, Shield, Sparkles } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConversationThread } from '../../../shared/types/thread'
import { i18n } from '../../i18n'

const STARTERS = ['tour', 'review', 'bugs', 'next'] as const

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
  return <section className="thread-opening" aria-label={t('opening.label')} data-testid="thread-empty">
    {/* A worktree of its own is named by its branch in the title: its folder carries a random suffix nobody chose. */}
    <h2>{t('opening.title', { agent, folder: thread.ownedWorktree?.branch ?? folder })}</h2>
    <ul className="thread-opening-context" aria-label={t('opening.context')}>
      <li title={thread.rootPath}><FolderGit2 size={13} aria-hidden="true" />{folder}</li>
      {branch && <li><GitBranch size={13} aria-hidden="true" />{branch}</li>}
      <li><Shield size={13} aria-hidden="true" />{t(`opening.access.${thread.access ?? 'read-only'}`)}</li>
      {thread.model && <li><Sparkles size={13} aria-hidden="true" />{thread.model}</li>}
    </ul>
    <div className="thread-opening-starters" role="group" aria-label={t('opening.starters')}>
      {threadStarters().map(starter => <button key={starter.id} type="button" className="thread-opening-starter" title={starter.prompt} onClick={() => onStarter(starter.prompt)}>
        <strong>{starter.label}</strong><span>{starter.prompt}</span>
      </button>)}
    </div>
  </section>
}
