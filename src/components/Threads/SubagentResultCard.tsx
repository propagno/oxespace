import { useState, type ReactElement } from 'react'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Card, StatusSignal, cx, type SignalState } from '../../ui'
import styles from './SubagentResultCard.module.css'

export type SubagentResultStatus = 'done' | 'failed' | 'running'

export interface SubagentResultCardProps {
  /** Subagent identifier (thread ID or worker ID). */
  agentId: string
  /** Optional display title or role; falls back to agentId. */
  title?: string
  /** Outcome status of the subagent execution. */
  status: SubagentResultStatus
  /** Full output text returned by the subagent. */
  output?: string
  /** Optional concise summary distinct from the full output. */
  summary?: string
  /** Execution duration in milliseconds. */
  durationMs?: number
  /** Optional metrics metadata (model, tokens, steps). */
  metrics?: string[]
  /** Optional action to open the subagent conversation. */
  onOpenConversation?: () => void
  /** Optional action to inspect full details. */
  onViewDetails?: () => void
  /** Character length threshold before collapsing output. */
  collapseThreshold?: number
  /** When true, wraps the output inside a collapsed `<details>` disclosure. */
  collapsibleOutput?: boolean
  className?: string
}

const DEFAULT_COLLAPSE_THRESHOLD = 240
const MAX_PREVIEW_LINES = 3

function toSignalState(status: SubagentResultStatus): SignalState {
  if (status === 'done') return 'done'
  if (status === 'failed') return 'failed'
  return 'working'
}

export function SubagentResultCard({
  agentId,
  title,
  status,
  output,
  summary,
  durationMs,
  metrics,
  onOpenConversation,
  onViewDetails,
  collapseThreshold = DEFAULT_COLLAPSE_THRESHOLD,
  collapsibleOutput = false,
  className
}: SubagentResultCardProps): ReactElement {
  const { t } = useTranslation('thread')
  const [expanded, setExpanded] = useState(false)

  const displayTitle = title?.trim() || agentId
  const statusLabel = t(`subagent.result.status.${status}`)
  const trimmedOutput = output?.trim() ?? ''
  const trimmedSummary = summary?.trim() ?? ''

  const durationText = durationMs !== undefined && durationMs >= 0
    ? durationMs < 1000
      ? t('subagent.result.durationMs', { value: Math.round(durationMs) })
      : durationMs < 60_000
        ? t('subagent.result.durationSeconds', { value: (durationMs / 1000).toFixed(1) })
        : t('subagent.result.durationMinutes', {
            minutes: Math.floor(durationMs / 60_000),
            seconds: Math.round((durationMs % 60_000) / 1000)
          })
    : null

  const metaParts = [durationText, ...(metrics ?? []).filter(Boolean)].filter((part): part is string => Boolean(part))

  const hasSeparateSummary = Boolean(trimmedSummary && trimmedOutput && trimmedSummary !== trimmedOutput)
  const useDisclosure = collapsibleOutput && Boolean(trimmedOutput) && !hasSeparateSummary
  const outputLines = trimmedOutput ? trimmedOutput.split(/\r?\n/) : []
  const isLongOutput = !hasSeparateSummary && !useDisclosure && (trimmedOutput.length > collapseThreshold || outputLines.length > MAX_PREVIEW_LINES)
  const canExpand = hasSeparateSummary || isLongOutput

  const previewText = (() => {
    if (hasSeparateSummary) return trimmedSummary
    if (!trimmedOutput) return ''
    if (!isLongOutput || expanded) return trimmedOutput
    if (outputLines.length > MAX_PREVIEW_LINES) {
      return `${outputLines.slice(0, MAX_PREVIEW_LINES).join('\n').slice(0, collapseThreshold).trimEnd()}…`
    }
    return `${trimmedOutput.slice(0, collapseThreshold).trimEnd()}…`
  })()

  return (
    <article data-ui="subagent-result" data-status={status} className={cx(styles.root, className)}>
      <Card surface="raised" padding="sm" data-status={status} className={styles.card}>
        <header className={styles.header}>
          <div className={styles.identity}>
            <StatusSignal state={toSignalState(status)} label={statusLabel} size={14} />
            <strong className={styles.title} title={agentId}>{displayTitle}</strong>
            <span className={styles.statusBadge} data-status={status}>{statusLabel}</span>
          </div>
          {metaParts.length > 0 && <span className={styles.meta}>{metaParts.join(' · ')}</span>}
        </header>

        {previewText ? (
          hasSeparateSummary ? (
            <>
              <p className={styles.summary}>{trimmedSummary}</p>
              {expanded && <pre className={styles.output}>{trimmedOutput}</pre>}
            </>
          ) : useDisclosure ? (
            <details className={cx('thread-subagent-result', styles.disclosure)}>
              <summary className={styles.disclosureSummary}>{t('subagent.viewResult')}</summary>
              <p className={styles.summary}>{trimmedOutput}</p>
            </details>
          ) : (
            <p className={styles.summary}>{previewText}</p>
          )
        ) : (
          <p className={styles.summary}>
            {status === 'running' ? t('subagent.result.runningSummary') : t('subagent.result.noOutput')}
          </p>
        )}

        {(canExpand || onOpenConversation || onViewDetails) && (
          <div className={styles.actions}>
            {canExpand && (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                icon={expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                onClick={() => setExpanded(current => !current)}
              >
                {expanded ? t('subagent.result.showLess') : t('subagent.result.showMore')}
              </Button>
            )}
            {onOpenConversation && (
              <Button
                variant="secondary"
                size="sm"
                icon={<ExternalLink size={14} aria-hidden="true" />}
                onClick={onOpenConversation}
              >
                {t('subagent.result.openConversation')}
              </Button>
            )}
            {onViewDetails && (
              <Button variant="ghost" size="sm" onClick={onViewDetails}>
                {t('subagent.result.viewDetails')}
              </Button>
            )}
          </div>
        )}
      </Card>
    </article>
  )
}
