import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { CheckCircle2, GitMerge, GitPullRequest, MessageSquare, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReviewQueueItem, ReviewRunDiff } from '../../../shared/schedule'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Badge, EmptyState, LoadingState, Notice } from '../../ui/Display'
import { cx } from '../../ui/cx'
import { toast } from '../../ui/Toast'
import { formatDateTime } from '../../utils/formatTime'
import styles from './ReviewQueuePanel.module.css'

const WHEN: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }

export interface ReviewQueuePanelProps {
  items: ReviewQueueItem[]
  loading: boolean
  onRefresh: () => Promise<void>
  onOpenThread: (threadId: string) => void
  onClose: () => void
}

export function ReviewQueuePanel({ items, loading, onRefresh, onOpenThread, onClose }: ReviewQueuePanelProps): ReactElement {
  const { t } = useTranslation('thread')
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.run.id ?? null)
  const [diff, setDiff] = useState<ReviewRunDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<'pr' | 'apply' | 'discard' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState<ReviewQueueItem | null>(null)

  const selected = useMemo(
    () => items.find((item) => item.run.id === selectedId) ?? items[0] ?? null,
    [items, selectedId]
  )

  useEffect(() => {
    if (!selected) {
      setDiff(null)
      return
    }
    if (selectedId !== selected.run.id) setSelectedId(selected.run.id)
    const fetchDiff = window.oxe?.schedules?.reviewDiff
    if (!fetchDiff) return
    let active = true
    setDiffLoading(true)
    setError(null)
    void fetchDiff(selected.run.id)
      .then((answer) => {
        if (!active) return
        if (answer.ok) setDiff(answer.value)
        else setError(t(`schedules.refusal.${answer.refusal}`, { defaultValue: t('schedules.refusal.other', { code: answer.refusal }) }))
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (active) setDiffLoading(false)
      })
    return () => { active = false }
  }, [selected, selectedId, t])

  const refusalMessage = useCallback(
    (code: string) => t(`schedules.refusal.${code}`, { defaultValue: t('schedules.refusal.other', { code }) }),
    [t]
  )

  const handleCreatePr = async (): Promise<void> => {
    if (!selected || !window.oxe?.schedules?.createPrFromRun) return
    setBusyAction('pr')
    setError(null)
    try {
      const answer = await window.oxe.schedules.createPrFromRun(selected.run.id)
      if (answer.ok) {
        toast({ intent: 'success', title: t('schedules.review.prCreated', { name: selected.scheduleName }) })
        await onRefresh()
      } else {
        setError(refusalMessage(answer.refusal))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyAction(null)
    }
  }

  const handleApply = async (): Promise<void> => {
    if (!selected || !window.oxe?.schedules?.applyRunToCheckout) return
    setBusyAction('apply')
    setError(null)
    try {
      const answer = await window.oxe.schedules.applyRunToCheckout(selected.run.id)
      if (answer.ok) {
        toast({ intent: 'success', title: t('schedules.review.applied', { name: selected.scheduleName }) })
        await onRefresh()
      } else {
        setError(refusalMessage(answer.refusal))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyAction(null)
    }
  }

  const handleDiscard = async (): Promise<void> => {
    if (!confirmDiscard || !window.oxe?.schedules?.discardRun) return
    setBusyAction('discard')
    setError(null)
    try {
      const answer = await window.oxe.schedules.discardRun(confirmDiscard.run.id)
      if (answer.ok) {
        toast({ title: t('schedules.review.discarded', { name: confirmDiscard.scheduleName }) })
        setConfirmDiscard(null)
        await onRefresh()
      } else {
        setError(refusalMessage(answer.refusal))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyAction(null)
    }
  }

  if (loading && items.length === 0) return <LoadingState />
  if (items.length === 0) {
    return (
      <EmptyState icon={<CheckCircle2 size={20} />} title={t('schedules.review.emptyTitle')}>
        {t('schedules.review.emptyDetail')}
      </EmptyState>
    )
  }

  const additions = diff?.additions ?? selected?.run.additions ?? 0
  const deletions = diff?.deletions ?? selected?.run.deletions ?? 0
  const filesChanged = diff?.filesChanged ?? selected?.run.filesChanged ?? 0
  const summary = diff?.summaryMd ?? selected?.run.summaryMd ?? null
  const diffLines = diff?.unifiedDiff ? diff.unifiedDiff.split(/\r?\n/) : []

  return (
    <div className={styles.split} data-testid="review-queue-panel">
      <ul className={styles.listCol} data-testid="review-queue-list" aria-label={t('schedules.tabs.reviewQueue')}>
        {items.map((item) => {
          const isSelected = selected?.run.id === item.run.id
          return (
            <li key={item.run.id}>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={isSelected}
                className={cx(styles.runButton, isSelected && styles.runSelected)}
                onClick={() => setSelectedId(item.run.id)}
              >
                <span className={styles.runCard}>
                  <span className={styles.runTitle}>{item.scheduleName}</span>
                  <span className={styles.runMeta}>
                    <span className={styles.statAdd}>+{item.run.additions ?? 0}</span>
                    <span className={styles.statDel}>-{item.run.deletions ?? 0}</span>
                    <span>{t('schedules.review.filesCount', { count: item.run.filesChanged ?? 0 })}</span>
                    <span>{formatDateTime(item.run.finishedAt ?? item.run.at, WHEN)}</span>
                  </span>
                </span>
              </Button>
            </li>
          )
        })}
      </ul>

      {selected && (
        <div className={styles.detailCol} data-testid="review-queue-detail">
          <div className={styles.detailHeader}>
            <div className={styles.detailTitleRow}>
              <h3 className={styles.detailTitle}>{selected.scheduleName}</h3>
              {selected.run.branchName && <code className={styles.branchCode}>{selected.run.branchName}</code>}
              <Badge intent="info">
                <span className={styles.statAdd}>+{additions}</span> / <span className={styles.statDel}>-{deletions}</span>
              </Badge>
              <Badge>{t('schedules.review.filesCount', { count: filesChanged })}</Badge>
            </div>
            <div className={styles.actionsRow}>
              {selected.run.worktreePath && (
                <>
                  <Button variant="primary" size="sm" disabled={busyAction !== null} onClick={() => void handleCreatePr()}>
                    <GitPullRequest size={14} aria-hidden="true" />
                    {t('schedules.review.createPr')}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={busyAction !== null} onClick={() => void handleApply()}>
                    <GitMerge size={14} aria-hidden="true" />
                    {t('schedules.review.apply')}
                  </Button>
                </>
              )}
              {selected.run.threadId && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyAction !== null}
                  onClick={() => {
                    onOpenThread(selected.run.threadId!)
                    onClose()
                  }}
                >
                  <MessageSquare size={14} aria-hidden="true" />
                  {t('schedules.openConversation')}
                </Button>
              )}
              <Button variant="danger" size="sm" disabled={busyAction !== null} onClick={() => setConfirmDiscard(selected)}>
                <Trash2 size={14} aria-hidden="true" />
                {t('schedules.review.discard')}
              </Button>
            </div>
          </div>

          {error && <Notice intent="danger">{error}</Notice>}
          {summary && <p className={styles.summaryBox}>{summary}</p>}

          {diffLoading ? (
            <LoadingState />
          ) : (
            <>
              {diff && diff.files.length > 0 && (
                <ul className={styles.filesList} aria-label={t('schedules.review.changedFiles')}>
                  {diff.files.map((file) => (
                    <li key={file.path} className={styles.fileRow}>
                      <span>{file.path}</span>
                      <span>
                        <span className={styles.statAdd}>+{file.additions}</span>{' '}
                        <span className={styles.statDel}>-{file.deletions}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {diffLines.length > 0 ? (
                <pre className={styles.diffViewer} data-testid="review-queue-diff">
                  {diffLines.map((line, index) => (
                    <span
                      key={index}
                      className={cx(
                        styles.diffLine,
                        line.startsWith('+') && !line.startsWith('+++') && styles.diffAdd,
                        line.startsWith('-') && !line.startsWith('---') && styles.diffDel,
                        line.startsWith('@@') && styles.diffHunk
                      )}
                    >
                      {line}
                    </span>
                  ))}
                </pre>
              ) : (
                <Notice intent="info">{t('schedules.review.noDiff')}</Notice>
              )}
            </>
          )}
        </div>
      )}

      {confirmDiscard && (
        <ConfirmDialog
          testId="review-confirm-discard"
          danger
          title={t('schedules.review.discardTitle', { name: confirmDiscard.scheduleName })}
          description={t('schedules.review.discardDetail')}
          confirmLabel={t('schedules.review.discardConfirm')}
          busy={busyAction === 'discard'}
          onConfirm={() => void handleDiscard()}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}
    </div>
  )
}
