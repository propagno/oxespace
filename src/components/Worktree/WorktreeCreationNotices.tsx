import { X } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { MainMessage } from '../../../shared/messages'
import type { WorktreeProvisionReport } from '../../../shared/types/repo-config'
import { formatMainMessage } from '../../i18n/mainMessage'
import { Button, Notice, type NoticeIntent } from '../../ui'
import styles from './WorktreeTemplateSection.module.css'

/** What went as asked: the worktree itself, shared dirs linked, files copied, the setup hook passing. */
const DONE = new Set<string>([
  'worktree.created',
  'worktree.createdFrom',
  'worktree.sharedDirs.linked',
  'worktree.copyFiles.copied',
  'worktree.setup.complete'
])
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
 * What creating a worktree reported (C3: `GitHubMessageResult.notices` + OXE-444 `WorktreeProvisionReport`):
 * the creation first, as the title, then what the template did, each line in the interface language,
 * plus structured summary and redacted setup hook failure tail when present.
 */
export function WorktreeCreationNotices({
  notices,
  report,
  onDismiss
}: {
  notices: readonly MainMessage[]
  report?: WorktreeProvisionReport | null
  onDismiss: () => void
}): ReactElement | null {
  const { t } = useTranslation('code')
  if (notices.length === 0) return null
  // The title is the creation by its code, wherever it sits; without one, the first notice (FRONTEND review #485).
  const titleAt = Math.max(0, notices.findIndex((notice) => notice.code === 'worktree.created' || notice.code === 'worktree.createdFrom'))
  const first = notices[titleAt]
  const rest = notices.filter((_, index) => index !== titleAt)
  const hasSummary = Boolean(
    report && (report.linked.length > 0 || report.copied.length > 0 || report.skipped.length > 0)
  )

  return (
    <Notice
      intent={worktreeNoticesIntent(notices)}
      title={formatMainMessage(first)}
      actions={<Button size="sm" variant="ghost" icon={<X size={12} aria-hidden="true" />} onClick={onDismiss}>{t('worktree.dismiss')}</Button>}
    >
      {rest.length > 0 ? (
        <ul data-testid="worktree-creation-notices">
          {rest.map((notice, index) => <li key={`${notice.code}-${index}`}>{formatMainMessage(notice)}</li>)}
        </ul>
      ) : null}
      {hasSummary && report ? (
        <div className={styles.reportSummary} data-testid="worktree-provision-summary">
          {report.linked.length > 0 ? (
            <div className={styles.reportMeta}>
              <strong>{t('worktree.template.dryRunLinked', { count: report.linked.length })}</strong>
              <span>{report.linked.join(', ')}</span>
            </div>
          ) : null}
          {report.copied.length > 0 ? (
            <div className={styles.reportMeta}>
              <strong>{t('worktree.template.dryRunCopied', { count: report.copied.length })}</strong>
              <span>{report.copied.join(', ')}</span>
            </div>
          ) : null}
          {report.skipped.length > 0 ? (
            <div className={styles.reportMeta}>
              <strong>{t('worktree.template.dryRunSkipped', { count: report.skipped.length })}</strong>
              <span>{report.skipped.map((s) => `${s.path} (${s.reason})`).join(', ')}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {report?.hookOutputTail ? (
        <pre className={styles.hookOutput} data-testid="worktree-hook-output-tail">
          {report.hookOutputTail}
        </pre>
      ) : null}
    </Notice>
  )
}
