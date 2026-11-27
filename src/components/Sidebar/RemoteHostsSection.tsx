import { Download, Plus, RefreshCw, ShieldAlert, Terminal, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteHostActivePane, RemoteSshHost } from '../../../shared/types/remote-hosts'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { deriveStatusTone } from '../../utils/paneDisplay'
import { Badge, Dialog, IconButton, Notice, SidebarRow, SidebarSection, StatusSignal, type SignalState } from '../../ui'
import { RemoteHostDialog } from './RemoteHostDialog'
import styles from './RemoteHosts.module.css'

export interface RemoteHostsSectionProps {
  activeWorkspaceId: string | null
  onActivatePane: (workspaceId: string, paneId: string) => Promise<void>
}

interface PendingHostPin {
  host: RemoteSshHost
  fingerprint: string
  changedFrom?: string
}

function signalForHost(
  pane: RemoteHostActivePane | undefined,
  terminalPanes: ReturnType<typeof useTerminalStore.getState>['panes']
): SignalState {
  if (!pane) return 'waiting'
  if (pane.status === 'disconnected' || pane.status === 'error') return 'failed'
  if (pane.status === 'connecting') return 'unconfirmed'
  const termState = terminalPanes[pane.paneId]
  if (termState) {
    const tone = deriveStatusTone(termState)
    if (tone === 'needs-decision') return 'needs-you'
    if (tone === 'thinking') return 'working'
    if (tone === 'awaiting') return 'done'
  }
  return 'done'
}

export function RemoteHostsSection({ activeWorkspaceId, onActivatePane }: RemoteHostsSectionProps): ReactElement | null {
  const { t } = useTranslation('code')
  const api = window.oxe?.remoteHosts
  const terminalPanes = useTerminalStore(s => s.panes)
  const [hosts, setHosts] = useState<RemoteSshHost[]>([])
  const [activePanes, setActivePanes] = useState<RemoteHostActivePane[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingPin, setPendingPin] = useState<PendingHostPin | null>(null)
  const [busyHostId, setBusyHostId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string>('')

  const refresh = useCallback(async () => {
    if (!api) return
    const [listRes, panesRes] = await Promise.all([
      api.call<RemoteSshHost[]>('hosts.list'),
      api.call<RemoteHostActivePane[]>('hosts.panes')
    ])
    if (listRes.ok) setHosts(listRes.data)
    if (panesRes.ok) setActivePanes(panesRes.data)
  }, [api])

  useEffect(() => {
    if (!api) return
    void refresh()
    return api.onChanged(() => { void refresh() })
  }, [api, refresh])

  if (!api) return null

  const openHostPane = async (host: RemoteSshHost): Promise<void> => {
    if (!activeWorkspaceId) {
      setFeedback(t('remoteHosts.selectWorkspaceFirst'))
      return
    }
    setFeedback('')
    setBusyHostId(host.id)
    try {
      const res = await api.call<RemoteHostActivePane>('hosts.openPane', {
        hostId: host.id,
        workspaceId: activeWorkspaceId
      })
      if (!res.ok) {
        if (res.error.code === 'host-key-unknown' && res.error.reasons?.[0]) {
          setPendingPin({ host, fingerprint: res.error.reasons[0] })
        } else if (res.error.code === 'host-key-changed' && res.error.reasons?.[1]) {
          setPendingPin({ host, changedFrom: res.error.reasons[0], fingerprint: res.error.reasons[1] })
        } else {
          setFeedback(res.error.message)
        }
        return
      }
      await useWorkspaceStore.getState().loadWorkspaces()
      await onActivatePane(res.data.workspaceId, res.data.paneId)
      await refresh()
    } finally {
      setBusyHostId(null)
    }
  }

  const trustAndConnect = async (): Promise<void> => {
    if (!pendingPin) return
    const target = pendingPin
    setPendingPin(null)
    const pinRes = await api.call<RemoteSshHost>('hosts.pinFingerprint', {
      id: target.host.id,
      fingerprint: target.fingerprint
    })
    if (!pinRes.ok) {
      setFeedback(pinRes.error.message)
      return
    }
    await openHostPane(pinRes.data)
  }

  const reconnectPane = async (paneId: string): Promise<void> => {
    setFeedback('')
    const res = await api.call('hosts.reconnectPane', { paneId })
    if (!res.ok) setFeedback(res.error.message)
    await refresh()
  }

  const importFromSshConfig = async (): Promise<void> => {
    setFeedback('')
    const res = await api.call<{ imported: RemoteSshHost[]; skipped: number }>('hosts.importConfig')
    if (!res.ok) {
      setFeedback(res.error.message)
      return
    }
    if (res.data.imported.length === 0) {
      setFeedback(t('remoteHosts.importNone'))
    } else {
      setFeedback(t('remoteHosts.importedCount', { count: res.data.imported.length }))
      await refresh()
    }
  }

  const removeHost = async (hostId: string): Promise<void> => {
    setFeedback('')
    await api.call('hosts.remove', { id: hostId })
    await refresh()
  }

  return (
    <section className={styles.section} aria-label={t('remoteHosts.title')} data-testid="remote-hosts-section">
      <SidebarSection
        label={t('remoteHosts.title')}
        alwaysShowAction
        action={
          <span className={styles.sectionActions}>
            <IconButton
              size="sm"
              variant="ghost"
              label={t('remoteHosts.importConfig')}
              icon={<Download size={12} aria-hidden="true" />}
              onClick={() => { void importFromSshConfig() }}
            />
            <IconButton
              size="sm"
              variant="ghost"
              label={t('remoteHosts.addHost')}
              icon={<Plus size={12} aria-hidden="true" />}
              onClick={() => setDialogOpen(true)}
            />
          </span>
        }
      />

      {feedback ? <div className={styles.hintRow}>{feedback}</div> : null}

      {hosts.length === 0 ? (
        <div className={styles.hintRow}>{t('remoteHosts.emptyHint')}</div>
      ) : (
        hosts.map(host => {
          const pane = activePanes.find(entry => entry.hostId === host.id)
          const signal = signalForHost(pane, terminalPanes)
          const statusLabel = pane
            ? t(`remoteHosts.status.${pane.status}`)
            : host.pinnedFingerprint
              ? t('remoteHosts.status.idle')
              : t('remoteHosts.status.unpinned')

          return (
            <SidebarRow
              key={host.id}
              data-testid="remote-host-row"
              lead={<StatusSignal state={signal} label={statusLabel} size={12} />}
              title={
                <span className={styles.rowTitle}>
                  <span className={styles.hostName} title={`${host.username}@${host.host}:${host.port}`}>{host.name}</span>
                  {!host.pinnedFingerprint ? <ShieldAlert size={12} aria-hidden="true" /> : null}
                </span>
              }
              meta={
                pane ? (
                  <Badge intent={pane.status === 'connected' ? 'success' : pane.status === 'disconnected' || pane.status === 'error' ? 'danger' : 'neutral'}>
                    {statusLabel}
                  </Badge>
                ) : (
                  <span className={styles.hostMeta}>{host.host}</span>
                )
              }
              onSelect={() => {
                if (pane) void onActivatePane(pane.workspaceId, pane.paneId)
                else void openHostPane(host)
              }}
              actions={
                <span className={styles.rowActions}>
                  {pane && (pane.status === 'disconnected' || pane.status === 'error') ? (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      label={t('remoteHosts.reconnect')}
                      icon={<RefreshCw size={12} aria-hidden="true" />}
                      onClick={() => { void reconnectPane(pane.paneId) }}
                    />
                  ) : (
                    <IconButton
                      size="sm"
                      variant="ghost"
                      disabled={busyHostId === host.id}
                      label={t('remoteHosts.openTerminal', { name: host.name })}
                      icon={<Terminal size={12} aria-hidden="true" />}
                      onClick={() => { void openHostPane(host) }}
                    />
                  )}
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label={t('remoteHosts.removeHost', { name: host.name })}
                    icon={<Trash2 size={12} aria-hidden="true" />}
                    onClick={() => { void removeHost(host.id) }}
                  />
                </span>
              }
            />
          )
        })
      )}

      {dialogOpen ? (
        <RemoteHostDialog
          onClose={() => setDialogOpen(false)}
          onSaved={() => { void refresh() }}
        />
      ) : null}

      {pendingPin ? (
        <Dialog
          size="sm"
          title={pendingPin.changedFrom ? t('remoteHosts.pin.changedTitle') : t('remoteHosts.pin.unknownTitle')}
          description={t('remoteHosts.pin.description', { host: `${pendingPin.host.host}:${pendingPin.host.port}` })}
          onClose={() => setPendingPin(null)}
          testId="remote-host-pin-dialog"
          actions={{
            cancel: { label: t('remoteHosts.dialog.cancel'), focus: true },
            primary: {
              label: t('remoteHosts.pin.trustAndConnect'),
              danger: Boolean(pendingPin.changedFrom),
              onClick: () => { void trustAndConnect() }
            }
          }}
        >
          <div className={styles.pinPrompt}>
            {pendingPin.changedFrom ? (
              <Notice intent="danger">{t('remoteHosts.pin.changedWarning', { previous: pendingPin.changedFrom })}</Notice>
            ) : null}
            <div className={styles.fingerprintBox}>
              <span className={styles.fingerprintLabel}>{t('remoteHosts.dialog.fingerprintLabel')}</span>
              <code className={styles.fingerprintValue}>{pendingPin.fingerprint}</code>
            </div>
          </div>
        </Dialog>
      ) : null}
    </section>
  )
}
