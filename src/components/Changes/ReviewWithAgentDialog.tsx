import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { THREAD_PROVIDERS, threadProductName } from '../../../shared/threadProviders'
import type { GitDiffSummaryFile } from '../../../shared/types/git'
import type { ThreadProvider } from '../../../shared/types/thread'
import { Dialog, ErrorState, Notice, Select } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { formatCount } from './changesModel'
import { launchReadOnlyAgentReview, pickDefaultReviewerProvider, scopeTranslationKey, type ReviewScopeKind } from './reviewWithAgent'

export interface ReviewWithAgentDialogProps {
  workspaceId: string
  rootPath: string
  scope: ReviewScopeKind
  base: string | null
  head: string | null
  files: GitDiffSummaryFile[]
  additions: number
  deletions: number
  currentProvider?: ThreadProvider | null
  onClose: () => void
  onStarted: (provider: ThreadProvider) => void
}

/**
 * Confirmation dialog for launching a separate read-only review session with another agent.
 * Built exclusively from src/ui primitives (Dialog, Notice, Select, ErrorState).
 */
export function ReviewWithAgentDialog({
  workspaceId,
  rootPath,
  scope,
  base,
  head,
  files,
  additions,
  deletions,
  currentProvider,
  onClose,
  onStarted
}: ReviewWithAgentDialogProps): ReactElement {
  const { t } = useTranslation('code')
  const [provider, setProvider] = useState<ThreadProvider>(() => pickDefaultReviewerProvider(currentProvider))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async (): Promise<void> => {
    if (pending) return
    setPending(true)
    setError('')
    try {
      await launchReadOnlyAgentReview({
        workspaceId,
        rootPath,
        provider,
        scope,
        base,
        head,
        files
      })
      onStarted(provider)
    } catch (cause) {
      setError(humanizeError(cause))
    } finally {
      setPending(false)
    }
  }

  const scopeLabel = t(`changes.scope.${scopeTranslationKey(scope)}`)

  return (
    <Dialog
      size="sm"
      testId="review-with-agent-dialog"
      title={t('changes.reviewAgent.dialogTitle')}
      description={t('changes.reviewAgent.dialogDescription')}
      onClose={() => { if (!pending) onClose() }}
      actions={{
        cancel: { label: t('changes.reviewAgent.cancel'), focus: true, unavailable: pending },
        primary: {
          label: pending ? t('changes.reviewAgent.starting') : t('changes.reviewAgent.confirm'),
          loading: pending,
          disabled: pending,
          onClick: () => void handleConfirm()
        }
      }}
    >
      <div className="changes-review-agent-body">
        <Notice intent="info" title={t('changes.reviewAgent.readOnlyTitle')}>
          {t('changes.reviewAgent.readOnlyBody')}
        </Notice>
        <div className="changes-review-agent-summary">
          <span>{t('changes.reviewAgent.scopeSummary', { scope: scopeLabel, count: files.length })}</span>
          {(additions > 0 || deletions > 0) && (
            <span className="changes-totals">
              {additions > 0 && <span className="is-add">+{formatCount(additions)}</span>}
              {deletions > 0 && <span className="is-del">−{formatCount(deletions)}</span>}
            </span>
          )}
        </div>
        <Select
          label={t('changes.reviewAgent.selectLabel')}
          hint={t('changes.reviewAgent.selectHint')}
          value={provider}
          disabled={pending}
          onChange={event => setProvider(event.target.value as ThreadProvider)}
          options={THREAD_PROVIDERS.map(id => ({ value: id, label: threadProductName(id) }))}
        />
        {error && <ErrorState compact title={t('changes.reviewAgent.failedTitle')} message={error} />}
      </div>
    </Dialog>
  )
}
