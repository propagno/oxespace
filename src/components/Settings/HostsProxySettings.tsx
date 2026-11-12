import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostsProxyRow, HostsProxyStatus } from '../../../shared/types/ipc'
import { formatMainMessage } from '../../i18n/mainMessage'
import { Button } from '../../ui/Button'
import { Badge, EmptyState, Notice } from '../../ui/Display'
import { Switch, TextField } from '../../ui/Field'
import { SettingsSection } from '../../ui/Settings'
import { useModalSurface } from '../../ui/useModalSurface'
import { formatDate } from '../../utils/formatTime'
import styles from './HostsProxySettings.module.css'

const NEW_HOST_WINDOW_MS = 24 * 3_600_000
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function isNewExternalHost(row: HostsProxyRow, nowTs: number): boolean {
  if (nowTs <= 0) return false
  const normalized = row.host.trim().toLowerCase()
  if (LOOPBACK_HOSTS.has(normalized)) return false
  return nowTs - row.firstSeen < NEW_HOST_WINDOW_MS
}

function ClearHostsDialog({
  title,
  body,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  title: string
  body: string
  cancelLabel: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}): ReactElement {
  const surface = useModalSurface<HTMLDivElement>(onCancel)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onCancel}>
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
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export interface HostsProxySettingsProps {
  onOpenConversation?: (conversationId: string) => void
}

export function HostsProxySettings({ onOpenConversation }: HostsProxySettingsProps): ReactElement {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<HostsProxyStatus>({
    enabled: false,
    state: 'stopped',
    hosts: []
  })
  const [nowTs, setNowTs] = useState<number>(0)
  const [toggleCallout, setToggleCallout] = useState<'on' | 'off' | null>(null)
  const [filter, setFilter] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const api = window.oxe?.hostsProxy
    if (!api?.state) return
    try {
      const next = await api.state()
      if (next && typeof next === 'object') {
        setNowTs(Date.now())
        setStatus({
          enabled: Boolean(next.enabled),
          state: next.state === 'running' || next.state === 'failed' ? next.state : 'stopped',
          reason: next.reason,
          hosts: Array.isArray(next.hosts) ? next.hosts : []
        })
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void refresh()
    const off = window.oxe?.hostsProxy?.onChanged?.(() => {
      void refresh()
    })
    return () => {
      off?.()
    }
  }, [refresh])

  const sortedHosts = useMemo(
    () => [...status.hosts].sort((a, b) => b.lastSeen - a.lastSeen),
    [status.hosts]
  )

  const filteredHosts = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return sortedHosts
    return sortedHosts.filter(
      row =>
        row.host.toLowerCase().includes(needle) ||
        String(row.port).includes(needle) ||
        (row.conversationTitle?.toLowerCase().includes(needle) ?? false)
    )
  }, [filter, sortedHosts])

  const handleToggle = (checked: boolean): void => {
    setToggleCallout(checked ? 'on' : 'off')
    void (async () => {
      await window.oxe?.hostsProxy?.setEnabled?.(checked)
      await refresh()
    })()
  }

  const handleRetry = (): void => {
    void (async () => {
      await window.oxe?.hostsProxy?.retry?.()
      await refresh()
    })()
  }

  const handleConfirmClear = (): void => {
    setConfirmClear(false)
    void (async () => {
      await window.oxe?.hostsProxy?.clear?.()
      await refresh()
    })()
  }

  const failureReason =
    status.state === 'failed'
      ? formatMainMessage(status.reason ?? { code: 'hostsProxy.failed', params: {} })
      : null

  return (
    <SettingsSection title={t('hostsProxy.sectionTitle')}>
      <Switch
        checked={status.enabled}
        onChange={handleToggle}
        label={t('hostsProxy.toggleLabel')}
        description={t('hostsProxy.toggleHint')}
      />

      {toggleCallout === 'on' ? (
        <Notice intent="info">{t('hostsProxy.turnedOnNotice')}</Notice>
      ) : toggleCallout === 'off' ? (
        <Notice intent="info">{t('hostsProxy.turnedOffNotice')}</Notice>
      ) : null}

      {failureReason ? (
        <Notice
          intent="warning"
          actions={
            <Button variant="secondary" size="sm" onClick={handleRetry}>
              {t('hostsProxy.tryAgain')}
            </Button>
          }
        >
          {failureReason}
        </Notice>
      ) : null}

      {status.enabled ? (
        sortedHosts.length === 0 ? (
          <EmptyState compact title={t('hostsProxy.empty')} />
        ) : (
          <div className={styles.tableWrap}>
            <div className={styles.controls}>
              <div className={styles.filterWrap}>
                <TextField
                  label={t('hostsProxy.filterLabel')}
                  value={filter}
                  onChange={event => setFilter(event.currentTarget.value)}
                />
              </div>
              <Button variant="secondary" size="sm" onClick={() => setConfirmClear(true)}>
                {t('hostsProxy.clearList')}
              </Button>
            </div>

            {filteredHosts.length === 0 ? (
              <EmptyState compact title={t('hostsProxy.noMatch')} />
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('hostsProxy.columns.host')}</th>
                    <th scope="col">{t('hostsProxy.columns.port')}</th>
                    <th scope="col">{t('hostsProxy.columns.from')}</th>
                    <th scope="col">{t('hostsProxy.columns.count')}</th>
                    <th scope="col">{t('hostsProxy.columns.lastSeen')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHosts.map(row => (
                    <tr key={`${row.host}:${row.port}:${row.conversationId ?? ''}`}>
                      <td>{row.host}</td>
                      <td className={styles.numCell}>{row.port}</td>
                      <td>
                        {row.conversationId ? (
                          <a
                            href={`#conversation-${row.conversationId}`}
                            className={styles.convLink}
                            onClick={event => {
                              event.preventDefault()
                              onOpenConversation?.(row.conversationId!)
                            }}
                          >
                            {row.conversationTitle || row.conversationId}
                          </a>
                        ) : (
                          <span className={styles.mutedText}>{t('hostsProxy.outsideConversation')}</span>
                        )}
                      </td>
                      <td className={styles.numCell}>{row.count}</td>
                      <td>
                        <span className={styles.lastSeenCell}>
                          <span>{formatDate(new Date(row.lastSeen))}</span>
                          {isNewExternalHost(row, nowTs) ? (
                            <Badge intent="info">{t('hostsProxy.newBadge')}</Badge>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      ) : null}

      {confirmClear ? (
        <ClearHostsDialog
          title={t('hostsProxy.clearDialog.title')}
          body={t('hostsProxy.clearDialog.body')}
          cancelLabel={t('hostsProxy.clearDialog.cancel')}
          confirmLabel={t('hostsProxy.clearDialog.confirm')}
          onCancel={() => setConfirmClear(false)}
          onConfirm={handleConfirmClear}
        />
      ) : null}
    </SettingsSection>
  )
}
