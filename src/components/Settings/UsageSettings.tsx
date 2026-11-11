import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { FeatureUsageStatus } from '../../../shared/feature-usage'
import { i18n } from '../../i18n'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/Display'
import { Switch } from '../../ui/Field'
import { SettingsSection } from '../../ui/Settings'
import { useModalSurface } from '../../ui/useModalSurface'
import { formatDate } from '../../utils/formatTime'
import styles from './UsageSettings.module.css'

/** Localized person-facing name for each key in FEATURE_USAGE_KEYS (never the raw key). */
export function featureUsageName(key: string): string {
  return i18n.t(`usage.features.${key}`, { ns: 'settings', defaultValue: key })
}

function PromptDialog({
  title,
  body,
  safeLabel,
  confirmLabel,
  onSafe,
  onConfirm,
  onDismiss
}: {
  title: string
  body: string
  safeLabel: string
  confirmLabel: string
  onSafe: () => void
  onConfirm: () => void
  onDismiss: () => void
}): ReactElement {
  const surface = useModalSurface<HTMLDivElement>(onDismiss)
  const safeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    safeRef.current?.focus()
  }, [])

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onDismiss}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        {...surface}
        onMouseDown={event => event.stopPropagation()}
      >
        <h3 id={titleId} className={styles.dialogTitle}>{title}</h3>
        <p id={descId} className={styles.dialogBody}>{body}</p>
        <div className={styles.dialogActions}>
          <Button ref={safeRef} variant="secondary" onClick={onSafe}>
            {safeLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function UsageSettings(): ReactElement {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<FeatureUsageStatus>({ enabled: false, since: null, rows: [] })
  const [showAll, setShowAll] = useState(false)
  const [dialog, setDialog] = useState<'clear' | 'turnOff' | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const api = window.oxe?.featureUsage
    if (!api?.state) return
    try {
      const next = await api.state()
      if (next && typeof next === 'object') {
        setStatus({
          enabled: Boolean(next.enabled),
          since: typeof next.since === 'number' ? next.since : null,
          rows: Array.isArray(next.rows) ? next.rows : []
        })
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void refresh()
    const off = window.oxe?.featureUsage?.onChanged?.(() => {
      void refresh()
    })
    return () => {
      off?.()
    }
  }, [refresh])

  const sortedRows = useMemo(
    () => [...status.rows].sort((a, b) => b.uses - a.uses || b.lastUsed - a.lastUsed),
    [status.rows]
  )
  const visibleRows = showAll ? sortedRows : sortedRows.slice(0, 12)

  const handleToggle = (checked: boolean): void => {
    if (checked) {
      setShowAll(false)
      void (async () => {
        await window.oxe?.featureUsage?.setEnabled?.({ enabled: true })
        await refresh()
      })()
      return
    }
    setDialog('turnOff')
  }

  const handleTurnOff = (clear: boolean): void => {
    setDialog(null)
    setShowAll(false)
    void (async () => {
      await window.oxe?.featureUsage?.setEnabled?.(clear ? { enabled: false, clear: true } : { enabled: false })
      await refresh()
    })()
  }

  const handleExport = (): void => {
    void window.oxe?.featureUsage?.export?.()
  }

  const handleConfirmClear = (): void => {
    setDialog(null)
    setShowAll(false)
    void (async () => {
      await window.oxe?.featureUsage?.clear?.()
      await refresh()
    })()
  }

  return (
    <SettingsSection title={t('usage.sectionTitle')}>
      <Switch
        checked={status.enabled}
        onChange={handleToggle}
        label={t('usage.toggleLabel')}
        description={t('usage.toggleHint')}
      />

      {status.enabled ? (
        sortedRows.length === 0 ? (
          <EmptyState compact title={t('usage.empty')} />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('usage.columns.feature')}</th>
                  <th scope="col">{t('usage.columns.uses')}</th>
                  <th scope="col">{t('usage.columns.lastUsed')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => (
                  <tr key={row.feature}>
                    <td>{featureUsageName(row.feature)}</td>
                    <td className={styles.numCell}>{row.uses}</td>
                    <td className={styles.mutedCell}>{formatDate(new Date(row.lastUsed))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={styles.actions}>
              {!showAll && sortedRows.length > 12 ? (
                <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                  {t('usage.showAll')}
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" onClick={handleExport}>
                {t('usage.exportJson')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setDialog('clear')}>
                {t('usage.clearCount')}
              </Button>
            </div>
          </div>
        )
      ) : null}

      {dialog === 'clear' ? (
        <PromptDialog
          title={t('usage.clearDialog.title')}
          body={t('usage.clearDialog.body')}
          safeLabel={t('usage.clearDialog.cancel')}
          confirmLabel={t('usage.clearDialog.confirm')}
          onSafe={() => setDialog(null)}
          onConfirm={handleConfirmClear}
          onDismiss={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'turnOff' ? (
        <PromptDialog
          title={t('usage.turnOffDialog.title')}
          body={t('usage.turnOffDialog.body')}
          safeLabel={t('usage.turnOffDialog.keep')}
          confirmLabel={t('usage.turnOffDialog.clear')}
          onSafe={() => handleTurnOff(false)}
          onConfirm={() => handleTurnOff(true)}
          onDismiss={() => setDialog(null)}
        />
      ) : null}
    </SettingsSection>
  )
}
