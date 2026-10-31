import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { REMOTE_COMMANDS, REMOTE_FORBIDDEN, REMOTE_SUBSCRIPTIONS, type RemoteCommand, type RemoteForbidden } from '../../../shared/remote/protocol'
import { REMOTE_DEFAULT_DESKTOP_NAME, REMOTE_MAX_DESKTOP_NAME_LENGTH } from '../../../shared/types/remote'
import { Button, Dialog, ErrorState, LoadingState, Panel, Switch, TextField, toast } from '../../ui'
import { formatMainMessage } from '../../i18n/mainMessage'
import { remoteApi, useRemoteGateway, useRemoteStore } from '../../store/remote.store'
import { DevicesList } from './DevicesList'
import { DevicesPairing } from './DevicesPairing'
import styles from './DevicesSettings.module.css'

/** Set once the person has read the firewall explanation; it is shown before the first time the connection turns on. */
// TODO(CCR F9-3): use RemoteGatewayStatus.listenedBefore (persisted per profile) in place of localStorage.
export const FIREWALL_EXPLAINED_KEY = 'oxe.remote.firewallExplained'
// TODO(CCR F9-2): remote.* rejections carry C3 codes (remote.gateway.offline, remote.pairing.limit, remote.device.notFound,
// remote.device.invalidName, remote.desktop.invalidName, remote.pane.invalid), serialized as "English #c3 {json}":
// replace errorText with the shared messageFromError(cause) → formatMainMessage (BACKEND, #225/#204); never parse by hand.
const errorText = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)
const firewallExplained = (): boolean => { try { return localStorage.getItem(FIREWALL_EXPLAINED_KEY) === '1' } catch { return false } }
const rememberFirewallExplained = (): void => { try { localStorage.setItem(FIREWALL_EXPLAINED_KEY, '1') } catch { /* Shown again next time. */ } }

/** Catalog keys of what the protocol lets a phone do and what it never does (shared/remote/protocol.ts). */
const COMMAND_KEYS = {
  'thread.send': 'threadSend', 'thread.steer': 'threadSteer', 'thread.interrupt': 'threadInterrupt',
  'thread.respondRequest': 'threadRespondRequest', 'terminal.write': 'terminalWrite', 'thread.history': 'threadHistory',
  'agent.markSeen': 'agentMarkSeen'
} as const satisfies Record<RemoteCommand, string>
const FORBIDDEN_KEYS = {
  'oxequery.approve': 'oxequeryApprove', 'mcp.confirm': 'mcpConfirm', 'mcp.trust': 'mcpTrust', 'accounts.signIn': 'accountsSignIn',
  'accounts.token': 'accountsToken', 'secrets.read': 'secretsRead', 'secrets.write': 'secretsWrite', 'policy.edit': 'policyEdit',
  'thread.access': 'threadAccess', 'host.exec': 'hostExec'
} as const satisfies Record<RemoteForbidden, string>

/** Settings › Devices: the phone connection (off by default), pairing, paired phones and what a phone may do. */
export function DevicesSettings(): ReactElement {
  const { t } = useTranslation('settings')
  useRemoteGateway()
  const status = useRemoteStore(state => state.status)
  const devices = useRemoteStore(state => state.devices)
  const loadError = useRemoteStore(state => state.loadError)
  const [toggling, setToggling] = useState(false)
  const [toggleError, setToggleError] = useState('')
  const [firewallOpen, setFirewallOpen] = useState(false)

  if (!remoteApi()) return <section className="settings-general" data-testid="devices-settings"><h2>{t('devices.title')}</h2><ErrorState compact title={t('devices.unavailable')} /></section>
  if (loadError && !status) return <section className="settings-general" data-testid="devices-settings"><h2>{t('devices.title')}</h2>
    <ErrorState compact title={t('devices.loadFailed')} detail={loadError} onRetry={() => void useRemoteStore.getState().reload()} /></section>
  if (!status || !devices) return <section className="settings-general" data-testid="devices-settings"><h2>{t('devices.title')}</h2><LoadingState /></section>

  const setEnabled = async (enabled: boolean): Promise<void> => {
    setToggling(true); setToggleError('')
    try { useRemoteStore.getState().apply({ status: await remoteApi()!.setEnabled({ enabled }) }) } catch (cause) { setToggleError(t('devices.gateway.failed', { error: errorText(cause) })) } finally { setToggling(false) }
  }
  const onToggle = (enabled: boolean): void => {
    if (enabled && !firewallExplained()) { setFirewallOpen(true); return }
    void setEnabled(enabled)
  }
  const listening = status.enabled && status.listening
  const full = devices.length >= status.maxDevices
  const blockedReason = !listening ? t('devices.pairing.needsGateway') : full ? t('devices.pairing.full', { max: status.maxDevices }) : null
  const windows = window.oxe?.app?.platform === 'win32'

  return <section className="settings-general" data-testid="devices-settings">
    <h2>{t('devices.title')}</h2>
    <div className={styles.page}>
      <p className={styles.intro}>{t('devices.intro')}</p>
      <Panel title={t('devices.gateway.title')} label={t('devices.gateway.title')}>
        <div className={styles.stack}>
          <Switch checked={status.enabled} disabled={toggling} onChange={onToggle} label={t('devices.gateway.label')} description={t('devices.gateway.hint')} />
          <p className={styles.meta} data-testid="devices-gateway-state">{listening && status.listening
            ? t('devices.gateway.listening', { addresses: status.listening.addresses.join(', '), port: status.listening.port }) : t('devices.gateway.off')}</p>
          {status.error ? <div data-testid="devices-gateway-error"><ErrorState compact title={formatMainMessage(status.error)} /></div> : null}
          {toggleError ? <ErrorState compact title={toggleError} /> : null}
        </div>
      </Panel>
      <DesktopName current={status.desktopName} />
      <DevicesPairing canPair={!blockedReason} blockedReason={blockedReason} />
      <DevicesList devices={devices} maxDevices={status.maxDevices} />
      <PhoneTyping panes={status.phoneWritePanes} />
      <Panel title={t('devices.scope.title')} label={t('devices.scope.title')}>
        <div className={styles.scope}>
          <div><h4>{t('devices.scope.can')}</h4><ul data-testid="devices-scope-can">
            {REMOTE_SUBSCRIPTIONS.map(id => <li key={id}>{t(`devices.scope.subscriptions.${id}`)}</li>)}
            {REMOTE_COMMANDS.map(id => <li key={id}>{t(`devices.scope.commands.${COMMAND_KEYS[id]}`)}</li>)}
          </ul></div>
          <div><h4>{t('devices.scope.cannot')}</h4><ul data-testid="devices-scope-cannot">
            {REMOTE_FORBIDDEN.map(id => <li key={id}>{t(`devices.scope.forbidden.${FORBIDDEN_KEYS[id]}`)}</li>)}
          </ul><p className={styles.meta}>{t('devices.scope.deskOnly')}</p></div>
        </div>
      </Panel>
    </div>
    {firewallOpen ? <Dialog title={t('devices.firewall.title')} size="sm" testId="devices-firewall" onClose={() => setFirewallOpen(false)}
      footer={<>
        <Button autoFocus onClick={() => setFirewallOpen(false)}>{t('devices.pairing.cancel')}</Button>
        <Button variant="primary" onClick={() => { rememberFirewallExplained(); setFirewallOpen(false); void setEnabled(true) }}>{t('devices.firewall.confirm')}</Button>
      </>}>
      <div className={styles.stack}>
        <p>{windows ? t('devices.firewall.windowsAsk') : t('devices.firewall.otherAsk')}</p>
        {windows ? <p>{t('devices.firewall.windowsPublic')}</p> : null}
        <p>{t('devices.firewall.internet')}</p>
        <p className={styles.meta}>{t('devices.firewall.later')}</p>
      </div>
    </Dialog> : null}
  </section>
}

/** The name phones see. "OXESpace" until the person picks one; the host name is never offered or sent. */
function DesktopName({ current }: { current: string }): ReactElement {
  const { t } = useTranslation('settings')
  // What the person is typing; null shows the saved name.
  const [edited, setEdited] = useState<string | null>(null)
  const draft = edited ?? current
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const trimmed = draft.trim()
  const invalid = !trimmed ? t('devices.name.empty') : trimmed.length > REMOTE_MAX_DESKTOP_NAME_LENGTH ? t('devices.name.tooLong', { max: REMOTE_MAX_DESKTOP_NAME_LENGTH }) : ''
  const save = async (name: string | null): Promise<void> => {
    setBusy(true); setError('')
    try {
      const status = await remoteApi()!.setDesktopName({ name })
      useRemoteStore.getState().apply({ status })
      setEdited(null)
      toast({ title: t('devices.name.saved', { name: status.desktopName }), intent: 'success', duration: 2500 })
    } catch (cause) { setError(t('devices.name.failed', { error: errorText(cause) })) } finally { setBusy(false) }
  }
  return <Panel title={t('devices.name.title')} label={t('devices.name.title')}>
    <form className={styles.row} onSubmit={event => { event.preventDefault(); if (!invalid && trimmed !== current) void save(trimmed) }}>
      <TextField label={t('devices.name.label')} hint={t('devices.name.hint')} error={draft !== current ? invalid || undefined : undefined} value={draft}
        maxLength={REMOTE_MAX_DESKTOP_NAME_LENGTH} onChange={event => setEdited(event.currentTarget.value)} />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={busy} disabled={busy || !!invalid || trimmed === current}>{t('devices.name.save')}</Button>
        {current !== REMOTE_DEFAULT_DESKTOP_NAME ? <Button disabled={busy} onClick={() => void save(null)}>{t('devices.name.reset', { name: REMOTE_DEFAULT_DESKTOP_NAME })}</Button> : null}
      </div>
    </form>
    {error ? <ErrorState compact title={error} /> : null}
  </Panel>
}

/** Which terminals a phone may type into: set per pane from its ⋯ menu, off again when the app restarts. */
function PhoneTyping({ panes }: { panes: string[] }): ReactElement {
  const { t } = useTranslation('settings')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const stopAll = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      for (const paneId of panes) useRemoteStore.getState().apply({ status: await remoteApi()!.setPhoneWrite({ paneId, allowed: false }) })
    } catch (cause) { setError(t('devices.typing.failed', { error: errorText(cause) })) } finally { setBusy(false) }
  }
  return <Panel title={t('devices.typing.title')} label={t('devices.typing.title')}>
    <div className={styles.stack}>
      <p className={styles.meta} data-testid="devices-typing">{panes.length ? t('devices.typing.some', { count: panes.length }) : t('devices.typing.none')}</p>
      {panes.length ? <div className={styles.actions}><Button loading={busy} disabled={busy} onClick={() => void stopAll()}>{t('devices.typing.stopAll')}</Button></div> : null}
      {error ? <ErrorState compact title={error} /> : null}
    </div>
  </Panel>
}
