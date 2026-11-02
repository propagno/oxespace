import { X } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { MainMessage } from '../../../shared/messages'
import { formatMainMessage } from '../../i18n/mainMessage'
import { Button, Notice, type NoticeIntent } from '../../ui'

/** What went as asked: the worktree itself, files copied, the setup hook passing. */
const DONE = new Set<string>(['worktree.created', 'worktree.createdFrom', 'worktree.copyFiles.copied', 'worktree.setup.complete'])
/** Worth knowing, nothing to fix: hooks are never run on the person's own git (#387). */
const INFO = new Set<string>(['git.hooks.skipped'])

/** A notice's weight: done, info, or something the person may want to act on (a refusal, a skipped file, a failed hook). */
export function worktreeNoticeIntent(message: MainMessage): NoticeIntent {
  return DONE.has(message.code) ? 'success' : INFO.has(message.code) ? 'info' : 'warning'
}

/** The whole block's weight: a warning when any line is one, else success when the worktree was made, else info. */
export function worktreeNoticesIntent(notices: readonly MainMessage[]): NoticeIntent {
  const intents = notices.map(worktreeNoticeIntent)
  return intents.includes('warning') ? 'warning' : intents.includes('success') ? 'success' : 'info'
}

/**
 * What creating a worktree reported (C3: `GitHubMessageResult.notices`): the creation first, as the title, then what
 * oxe.yaml did, each line in the interface language. Stays until the person dismisses it, like the panel's errors.
 */
export function WorktreeCreationNotices({ notices, onDismiss }: { notices: readonly MainMessage[]; onDismiss: () => void }): ReactElement | null {
  const { t } = useTranslation('code')
  if (notices.length === 0) return null
  const [first, ...rest] = notices
  return (
    <Notice
      intent={worktreeNoticesIntent(notices)}
      title={formatMainMessage(first)}
      actions={<Button size="sm" variant="ghost" icon={<X size={12} aria-hidden="true" />} onClick={onDismiss}>{t('worktree.dismiss')}</Button>}
    >
      {rest.length > 0 ? <ul data-testid="worktree-creation-notices">{rest.map((notice, index) => <li key={`${notice.code}-${index}`}>{formatMainMessage(notice)}</li>)}</ul> : null}
    </Notice>
  )
}
