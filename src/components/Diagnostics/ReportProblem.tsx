import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, copyText, Dialog, ErrorState, TextArea, TextField, toast } from '../../ui'
import { buildIssueUrl, issueClipboardText, type IssueDraft } from '../../../shared/issue-report'
import styles from './ReportProblem.module.css'

type State = { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready' }

/**
 * Help › Report a problem. The report is built on this computer and shown here to read and edit. It reaches
 * GitHub only when the person clicks "Open on GitHub" (their browser opens the issue page) or copies the text.
 */
export function ReportProblem({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [draft, setDraft] = useState<IssueDraft>({ title: '', body: '' })

  // Bumping the attempt re-runs the effect: "Try again" asks the main process once more.
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    window.oxe.diagnostics.buildIssueReport()
      .then(report => { if (current) { setDraft({ title: report.title, body: report.body }); setState({ phase: 'ready' }) } })
      .catch(() => { if (current) setState({ phase: 'failed' }) })
    return () => { current = false }
  }, [attempt])

  const ready = state.phase === 'ready'
  const link = ready ? buildIssueUrl(draft) : null
  const open = (): void => {
    if (!link) return
    window.open(link.url, '_blank', 'noopener,noreferrer')
    toast({ title: t('report.opened'), intent: 'success' })
    onClose()
  }
  const copy = async (): Promise<void> => { await copyText(issueClipboardText(draft), t('report.copyWhat'), t('report.copied')) }

  return <Dialog title={t('report.title')} description={t('report.description')} onClose={onClose} size="lg" testId="report-problem"
    footer={<>
      <Button variant="secondary" onClick={() => void copy()} disabled={!ready}>{t('report.copy')}</Button>
      <Button onClick={open} disabled={!ready || !draft.title.trim()}>{t('report.open')}</Button>
    </>}>
    {state.phase === 'loading' && <p className={styles.status} role="status">{t('report.loading')}</p>}
    {state.phase === 'failed' && <ErrorState title={t('report.failed')} retryLabel={t('report.retry')}
      onRetry={() => { setState({ phase: 'loading' }); setAttempt(count => count + 1) }} />}
    {ready && <div className={styles.form}>
      <TextField label={t('report.titleLabel')} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
      <TextArea label={t('report.bodyLabel')} hint={t('report.bodyHint')} mono rows={16} className={styles.body}
        value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} />
      {link?.truncated && <p className={styles.notice} role="note">{t('report.truncated')}</p>}
    </div>}
  </Dialog>
}
