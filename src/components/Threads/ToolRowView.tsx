import { useId, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolRow, ToolRowKind } from '../../../shared/thread-tool-rows'
import { Button, Spinner } from '../../ui'
import styles from './ToolRowView.module.css'

const KIND_KEYS = {
  read: 'fold.kinds.read',
  edit: 'fold.kinds.edit',
  run: 'fold.kinds.run',
  query: 'fold.kinds.query',
  http: 'fold.kinds.http',
  container: 'fold.kinds.container',
  other: 'fold.kinds.other'
} as const satisfies Record<ToolRowKind, string>

function formatRowTime(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function ToolRowView(props: { row: ToolRow; onSelect?: () => void }): ReactElement {
  const { row, onSelect } = props
  const { t } = useTranslation('thread')
  const [showTime, setShowTime] = useState(false)
  const tooltipId = useId()
  const kindKey = KIND_KEYS[row.kind in KIND_KEYS ? row.kind : 'other']

  return (
    <div
      className={styles.wrap}
      data-kind={row.kind}
      data-failed={row.failed ? 'true' : undefined}
      data-running={row.running ? 'true' : undefined}
    >
      <Button
        variant="ghost"
        size="sm"
        className={styles.row}
        aria-describedby={showTime ? tooltipId : undefined}
        onFocus={() => setShowTime(true)}
        onBlur={() => setShowTime(false)}
        onMouseEnter={() => setShowTime(true)}
        onMouseLeave={() => setShowTime(false)}
        onKeyDown={event => {
          if (event.key === 'Escape') setShowTime(false)
        }}
        onClick={onSelect}
      >
        <span className={styles.bar} aria-hidden="true" />
        {row.running && <Spinner size="sm" decorative />}
        <span className={styles.kind}>{t(kindKey)}</span>
        <span className={styles.target}>{row.target}</span>
        {(row.meta.additions || row.meta.deletions || row.truncated) && (
          <span className={styles.meta} aria-hidden="true">
            {row.meta.additions ? `+${row.meta.additions}` : ''}
            {row.meta.deletions ? ` -${row.meta.deletions}` : ''}
            {row.truncated ? ` · ${t('fold.truncated')}` : ''}
          </span>
        )}
      </Button>
      {showTime && (
        <span id={tooltipId} role="tooltip" className={styles.tooltip}>
          {formatRowTime(row.at)}
        </span>
      )}
    </div>
  )
}
