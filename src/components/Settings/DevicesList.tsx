import { useRef, useState, type ReactElement } from 'react'
import { Pencil, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { REMOTE_LIMITS } from '../../../shared/remote/protocol'
import type { RemoteDevice } from '../../../shared/types/remote'
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, IconButton, Panel, StatusDot, TextField, toast } from '../../ui'
import { remoteApi, useRemoteStore } from '../../store/remote.store'
import { formatDateTime } from '../../utils/formatTime'
import styles from './DevicesSettings.module.css'

const errorText = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

/** Paired phones with their last access; renaming and removing (which disconnects at once) are the person's. */
export function DevicesList({ devices, maxDevices }: { devices: RemoteDevice[]; maxDevices: number }): ReactElement {
  const { t } = useTranslation('settings')
  const [removing, setRemoving] = useState<RemoteDevice | null>(null)
  const [renaming, setRenaming] = useState<RemoteDevice | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lastTrigger = useRef<HTMLElement | null>(null)

  const close = (): void => { setRemoving(null); setRenaming(null); setError('') }
  const remove = async (): Promise<void> => {
    if (!removing) return
    setBusy(true); setError('')
    try {
      await remoteApi()?.revoke({ deviceId: removing.deviceId })
      const state = useRemoteStore.getState()
      state.apply({ devices: (state.devices ?? []).filter(device => device.deviceId !== removing.deviceId) })
      toast({ title: t('devices.list.removed', { name: removing.name }), intent: 'success' })
      close()
    } catch (cause) { setError(t('devices.list.failed', { error: errorText(cause) })) } finally { setBusy(false) }
  }
  const trimmed = name.trim()
  const nameValid = trimmed.length > 0 && trimmed.length <= REMOTE_LIMITS.maxDeviceNameLength
  const rename = async (): Promise<void> => {
    if (!renaming || !nameValid) return
    setBusy(true); setError('')
    try {
      const updated = await remoteApi()?.rename({ deviceId: renaming.deviceId, name: trimmed })
      if (updated) {
        const state = useRemoteStore.getState()
        state.apply({ devices: (state.devices ?? []).map(device => device.deviceId === updated.deviceId ? updated : device) })
      }
      close()
    } catch (cause) { setError(t('devices.list.failed', { error: errorText(cause) })) } finally { setBusy(false) }
  }

  return <Panel title={t('devices.list.title')} label={t('devices.list.title')} actions={<Badge>{t('devices.list.count', { count: devices.length, max: maxDevices })}</Badge>}>
    {devices.length === 0 ? <EmptyState compact icon={<Smartphone size={16} aria-hidden="true" />} title={t('devices.list.empty')}>{t('devices.list.emptyHint')}</EmptyState>
      : <ul className={styles.list} aria-label={t('devices.list.title')}>
        {devices.map(device => <li key={device.deviceId} className={styles.device} data-testid="devices-device">
          <StatusDot status={device.connected ? 'success' : 'idle'} label={device.connected ? t('devices.list.connected') : t('devices.list.disconnected')} />
          <div className={styles.deviceText}>
            <span className={styles.deviceName}>{device.name}</span>
            <span className={styles.meta}>
              {t('devices.list.paired', { date: formatDateTime(device.pairedAt) })} · {device.lastSeenAt === null ? t('devices.list.neverSeen') : t('devices.list.lastSeen', { date: formatDateTime(device.lastSeenAt) })}
            </span>
          </div>
          <IconButton label={t('devices.list.rename', { name: device.name })} icon={<Pencil size={14} aria-hidden="true" />} size="sm"
            onClick={event => { lastTrigger.current = event.currentTarget; setName(device.name); setRenaming(device) }} />
          <Button variant="danger" size="sm" aria-label={t('devices.list.removeLabel', { name: device.name })}
            onClick={event => { lastTrigger.current = event.currentTarget; setRemoving(device) }}>{t('devices.list.remove')}</Button>
        </li>)}
      </ul>}
    {removing ? <ConfirmDialog danger title={t('devices.list.removeTitle', { name: removing.name })} description={t('devices.list.removeDescription')}
      confirmLabel={t('devices.list.remove')} busy={busy} error={error} onConfirm={() => void remove()} onCancel={close} testId="devices-remove-confirm" /> : null}
    {renaming ? <Dialog title={t('devices.list.renameTitle')} size="sm" onClose={() => { if (!busy) close() }} returnFocusTo={() => lastTrigger.current}
      footer={<Button variant="primary" loading={busy} disabled={busy || !nameValid || trimmed === renaming.name} onClick={() => void rename()}>{t('devices.list.renameSave')}</Button>}>
      <form onSubmit={event => { event.preventDefault(); void rename() }}>
        <TextField label={t('devices.list.renameLabel')} value={name} maxLength={REMOTE_LIMITS.maxDeviceNameLength} autoFocus onChange={event => setName(event.currentTarget.value)} />
      </form>
      {error ? <ErrorState compact title={error} /> : null}
    </Dialog> : null}
  </Panel>
}
