import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApprovalDatabasePreview } from '../../../shared/types/approvals'
import type { ThreadRequest, ThreadRequestResponse } from '../../../shared/types/thread'
import { i18n } from '../../i18n'
import { Badge, Button, Checkbox, Dialog, Notice } from '../../ui'
import { formatNumber } from '../../utils/formatTime'
import styles from './Approvals.module.css'
import { HoldToApprove } from './HoldToApprove'
import { ImpactFacts } from './ImpactFacts'

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export function isChangedPreviewCell(cell: unknown): cell is { old: unknown; new: unknown } {
  return Boolean(cell && typeof cell === 'object' && 'old' in cell && 'new' in cell)
}

export function formatPreviewCell(cell: unknown): string {
  if (isChangedPreviewCell(cell)) {
    return `${formatScalar(cell.old)} → ${formatScalar(cell.new)}`
  }
  return formatScalar(cell)
}

export interface ImpactPreviewProps {
  request: ThreadRequest
  agent?: string
  conversation?: string
  onRespond: (response: ThreadRequestResponse) => Promise<void>
  onClose: () => void
}

export function ImpactPreview({
  request,
  agent,
  conversation,
  onRespond,
  onClose
}: ImpactPreviewProps): ReactElement | null {
  const { t } = useTranslation('thread')
  useEffect(() => { void window.oxe?.featureUsage?.record?.('approvalPreview') }, [])
  const [dbPreviewState, setDbPreviewState] = useState<{ requestId: string; result: ApprovalDatabasePreview } | null>(null)
  const [busy, setBusy] = useState(false)
  const [withoutHoldOpen, setWithoutHoldOpen] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const withoutHoldCancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!withoutHoldOpen) return
    withoutHoldCancelRef.current?.focus({ preventScroll: true })
    const timer = setTimeout(() => {
      withoutHoldCancelRef.current?.focus({ preventScroll: true })
    }, 0)
    return () => clearTimeout(timer)
  }, [withoutHoldOpen])

  const impact = request.impact

  useEffect(() => {
    if (impact?.kind !== 'db') return
    let active = true
    const previewFn = window.oxe?.approvals?.preview
    if (previewFn) {
      void previewFn(request.id)
        .then(result => {
          if (active && result && typeof result === 'object') {
            setDbPreviewState({ requestId: request.id, result })
          }
        })
        .catch(() => undefined)
    }
    return () => {
      active = false
    }
  }, [impact?.kind, request.id])

  const dbPreview = impact?.kind === 'db' && dbPreviewState?.requestId === request.id ? dbPreviewState.result : null

  if (!impact) return null

  const agentName = agent ?? t('f7.card.defaultAgent')
  const contextLine = conversation
    ? t('f7.preview.context', { agent: agentName, conversation })
    : agentName

  const respond = async (response: ThreadRequestResponse): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await onRespond(response)
    } finally {
      setBusy(false)
    }
  }

  const isCriticalIrreversible = !impact.reversible && impact.risk === 'critical'
  const countOverride = impact.kind === 'db' ? (dbPreview ? dbPreview.count : null) : undefined

  const reversibleText = impact.undoHow === 'checkpoint'
    ? t('f7.preview.reversibleCheckpoint')
    : impact.undoHow === 'start'
      ? t('f7.preview.reversibleStart')
      : t('f7.preview.reversibleGeneric')

  const closeWithoutHold = (): void => {
    setWithoutHoldOpen(false)
    setUnderstood(false)
  }

  const dialogTitle = (
    <span className={styles.previewDialogTitle}>
      <span className={styles.previewSunDot} aria-hidden="true" />
      <span>{request.title}</span>
      <Badge intent={impact.reversible ? 'success' : 'danger'}>
        {impact.reversible ? t('f7.facts.canUndo') : t('f7.facts.cannotUndo')}
      </Badge>
    </span>
  )

  const footer = (
    <>
      <Button
        variant="secondary"
        data-dialog-cancel=""
        autoFocus
        disabled={busy}
        onClick={() => void respond({ decision: 'decline' })}
      >
        {t('request.deny')}
        <kbd aria-hidden="true" className={styles.kbdHint}>D</kbd>
      </Button>
      {impact.reversible ? (
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void respond({ decision: 'accept' })}
        >
          {t('request.approve')}
          <kbd aria-hidden="true" className={styles.kbdHint}>A</kbd>
        </Button>
      ) : isCriticalIrreversible ? (
        <>
          <HoldToApprove
            label={t('f7.preview.holdToApprove')}
            shortcut="A"
            disabled={busy}
            onComplete={() => void respond({ decision: 'accept' })}
          />
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setUnderstood(false)
              setWithoutHoldOpen(true)
            }}
          >
            {t('f7.preview.approveWithoutHolding')}
          </Button>
        </>
      ) : (
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => void respond({ decision: 'accept' })}
        >
          {t('request.approve')}
          <kbd aria-hidden="true" className={styles.kbdHint}>A</kbd>
        </Button>
      )}
    </>
  )

  return (
    <>
      <Dialog size="lg" title={dialogTitle} onClose={onClose} footer={footer}>
        <div className={styles.previewStack}>
          <p className={styles.contextLine}>{contextLine}</p>

          {impact.why ? <p className={styles.whyText}>{impact.why}</p> : null}

          <ImpactFacts impact={impact} layout="grid" countOverride={countOverride} />

          {impact.kind === 'db' && dbPreview ? (
            <section className={styles.sectionBlock}>
              {dbPreview.status === 'ok' && dbPreview.sample ? (
                <>
                  <h3 className={styles.sectionHeading}>{t('f7.preview.beforeAfter')}</h3>
                  <p className={styles.sampleMeta}>
                    {t('f7.preview.sampleCount', {
                      sampleCount: dbPreview.sample.rows.length,
                      count: dbPreview.count ?? dbPreview.sample.rows.length,
                      formattedSample: formatNumber(dbPreview.sample.rows.length),
                      formattedCount: formatNumber(dbPreview.count ?? dbPreview.sample.rows.length)
                    })}
                  </p>
                  <div className={styles.sampleWrap}>
                    <table className={styles.sampleTable}>
                      <thead>
                        <tr>
                          {dbPreview.sample.cols.map(col => (
                            <th key={col} scope="col">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dbPreview.sample.rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} className={isChangedPreviewCell(cell) ? styles.changedCell : undefined}>
                                {formatPreviewCell(cell)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : dbPreview.status === 'off-production' ? (
                <p className={styles.noteLine}>{t('f7.preview.offProduction')}</p>
              ) : dbPreview.status === 'failed' ? (
                <p className={styles.noteLine}>{t('f7.preview.failed', { reason: dbPreview.reason ?? '' })}</p>
              ) : null}
            </section>
          ) : null}

          <section className={styles.sectionBlock}>
            <h3 className={styles.sectionHeading}>{t('f7.preview.exactHeading')}</h3>
            <pre className={styles.codeBlock}>
              <code>{impact.text}</code>
            </pre>
          </section>

          {impact.reversible ? (
            <Notice intent="success">{reversibleText}</Notice>
          ) : isCriticalIrreversible ? (
            <>
              <Notice intent="danger">{t('f7.preview.criticalCallout')}</Notice>
              <p className={styles.noteLine}>{t('f7.preview.criticalPhone')}</p>
            </>
          ) : (
            <>
              <Notice intent="warning">{t('f7.preview.highCallout')}</Notice>
              {impact.kind === 'db' ? (
                <p className={styles.noteLine}>{t('f7.preview.dbDesktopOnly')}</p>
              ) : null}
            </>
          )}
        </div>
      </Dialog>

      {withoutHoldOpen ? (
        <Dialog
          size="sm"
          title={t('f7.preview.withoutHoldTitle')}
          onClose={closeWithoutHold}
          footer={
            <>
              <Button
                ref={withoutHoldCancelRef}
                variant="secondary"
                data-dialog-cancel=""
                autoFocus
                onClick={closeWithoutHold}
              >
                {i18n.t('ui.cancel')}
              </Button>
              <Button
                variant="danger"
                data-dialog-primary=""
                disabled={!understood || busy}
                onClick={() => {
                  setWithoutHoldOpen(false)
                  void respond({ decision: 'accept' })
                }}
              >
                {t('request.approve')}
              </Button>
            </>
          }
        >
          <Checkbox
            checked={understood}
            onChange={event => setUnderstood(event.currentTarget.checked)}
            label={t('f7.preview.withoutHoldCheckbox')}
          />
        </Dialog>
      ) : null}
    </>
  )
}
