import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, ConfirmDialog, Notice, toast } from '../../ui'
import styles from './DevicesSettings.module.css'

/*
 * 1.4.3 P1 · Whether Windows lets a phone reach this computer, with a one-click repair.
 * The shapes mirror RemoteFirewallStatus / RemoteFirewallChange in shared/types/remote.ts (BACKEND #629). The preload
 * methods are optional, so an app without them (or off Windows) shows nothing.
 */
export type FirewallStatus =
  | { supported: false }
  | {
    supported: true
    port: number
    ruleName: string
    repairCommand: string
    undoCommand: string
    inspectionAvailable: boolean
    ruleAllowed: boolean
    blockingRuleDetected: boolean
    ownRulePresent: boolean
    privateFirewallEnabled: boolean
    networkCategory: 'public' | 'private' | 'domain' | 'unknown'
  }
export type FirewallChange =
  | { ok: true; status: FirewallStatus }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'failed' | 'not-verified'; status?: FirewallStatus }
type FirewallApi = {
  firewallStatus?: () => Promise<FirewallStatus>
  firewallRepair?: () => Promise<FirewallChange>
  firewallUndo?: () => Promise<FirewallChange>
}
const firewallApi = (): FirewallApi => (window.oxe?.remote ?? {}) as unknown as FirewallApi

type Checked = Extract<FirewallStatus, { supported: true }>
/** The one problem to show, most blocking first. A Block rule wins over everything; Public comes before a missing rule. */
export type FirewallProblem = 'blocked' | 'public' | 'noRule' | null
export function firewallProblem(status: Checked): FirewallProblem {
  if (status.blockingRuleDetected) return 'blocked'
  if (status.networkCategory === 'public') return 'public'
  if (!status.ruleAllowed) return 'noRule'
  return null
}

/**
 * One warning Notice for the one problem in the way, in Settings › Devices above pairing (so it is in view while the QR
 * shows). Hidden off Windows, in development builds, while the connection is off, and on a Domain network (IT's rules).
 * Allow and Remove show the exact rule and command first; Windows then asks for permission (UAC).
 */
export function DevicesFirewall({ listening, pairingKey, publicFallback }: { listening: boolean; pairingKey?: string | null
  /**
   * T86's Public-network Notice (from the gateway status), shown only when this check can't speak: an app without the
   * firewall methods, a read that failed, or `supported: false`. When the check runs it names the Public network itself,
   * so the person sees one alert for one problem.
   */
  publicFallback?: ReactNode }): ReactElement | null {
  const { t } = useTranslation('settings')
  // undefined: not read yet (nothing shows, so the fallback never flashes before the check answers); null: no check.
  const [status, setStatus] = useState<FirewallStatus | null | undefined>(firewallApi().firewallStatus ? undefined : null)
  const [confirming, setConfirming] = useState<'repair' | 'undo' | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  // What the last Allow or Remove came to, kept in view (a toast alone would leave with the outcome).
  const [outcome, setOutcome] = useState('')

  const check = useCallback(async (): Promise<void> => {
    const read = firewallApi().firewallStatus
    if (!read) { setStatus(null); return }
    setChecking(true)
    try { setStatus(await read()) } catch { setStatus(null) } finally { setChecking(false) }
  }, [])
  // Read when the connection starts listening and again when a pairing begins (the moment a phone needs to get in).
  useEffect(() => {
    const read = firewallApi().firewallStatus
    if (!listening || !read) return
    let live = true
    read().then(next => { if (live) setStatus(next) }, () => { if (live) setStatus(null) })
    return () => { live = false }
  }, [listening, pairingKey])

  if (!listening || status === undefined) return null
  if (!status?.supported) return publicFallback ? <>{publicFallback}</> : null
  if (status.networkCategory === 'domain') return null
  const problem = firewallProblem(status)
  const api = firewallApi()
  const canRepair = problem === 'noRule' && !!api.firewallRepair
  const canUndo = status.ownRulePresent && !!api.firewallUndo

  const change = async (kind: 'repair' | 'undo'): Promise<void> => {
    const run = kind === 'repair' ? api.firewallRepair : api.firewallUndo
    if (!run) return
    setBusy(true); setOutcome('')
    try {
      const result = await run()
      if (result.ok) {
        setStatus(result.status)
        toast({ title: t(`devices.firewallCheck.${kind}.done`), intent: 'success' })
      } else {
        if (result.status) setStatus(result.status)
        // The person said No at Windows' prompt: nothing changed, and nothing to report as a failure.
        if (result.reason !== 'cancelled') setOutcome(t(`devices.firewallCheck.${kind}.${result.reason === 'not-verified' ? 'notVerified' : 'failed'}`))
      }
    } catch {
      setOutcome(t(`devices.firewallCheck.${kind}.failed`))
    } finally { setBusy(false); setConfirming(null) }
  }

  const rule = t('devices.firewallCheck.rule', { port: status.port })
  const undoButton = canUndo ? <Button size="sm" disabled={busy} onClick={() => setConfirming('undo')}>{t('devices.firewallCheck.undo.action')}</Button> : null
  const checkButton = <Button size="sm" variant="ghost" loading={checking} disabled={busy} onClick={() => void check()}>{t('devices.firewallCheck.checkAgain')}</Button>

  return <div className={styles.stack} data-testid="devices-firewall-check">
    {problem ? <Notice intent="warning" title={t(`devices.firewallCheck.${problem}.title`)}
      actions={<div className={styles.actions}>
        {canRepair ? <Button size="sm" variant="primary" disabled={busy} onClick={() => setConfirming('repair')}>{t('devices.firewallCheck.repair.action')}</Button> : null}
        {undoButton}{checkButton}
      </div>}>
      <p>{t(`devices.firewallCheck.${problem}.text`)}</p>
      {problem === 'noRule' && !status.inspectionAvailable ? <p>{t('devices.firewallCheck.noInspection')}</p> : null}
      {canRepair ? <p className={styles.meta}>{t('devices.firewallCheck.repair.adds', { rule })}</p> : null}
      {outcome ? <p data-testid="devices-firewall-outcome">{outcome}</p> : null}
    </Notice>
      : canUndo ? <div className={styles.row}><p className={styles.meta} data-testid="devices-firewall-ok">{t('devices.firewallCheck.ok', { rule })}{outcome ? ` ${outcome}` : ''}</p><div className={styles.actions}>{undoButton}</div></div>
        : null}
    {confirming ? <ConfirmDialog testId="devices-firewall-confirm" busy={busy} danger={false}
      title={t(`devices.firewallCheck.${confirming}.confirmTitle`)}
      description={t(`devices.firewallCheck.${confirming}.explain`, { rule, name: status.ruleName })}
      confirmLabel={t(`devices.firewallCheck.${confirming}.confirm`)}
      onCancel={() => setConfirming(null)} onConfirm={() => void change(confirming)}>
      <div className={styles.stack}>
        <p>{t('devices.firewallCheck.uac')}</p>
        <p className={styles.meta}>{t('devices.firewallCheck.command')}</p>
        <pre className={styles.command} data-testid="devices-firewall-command">{confirming === 'repair' ? status.repairCommand : status.undoCommand}</pre>
      </div>
    </ConfirmDialog> : null}
  </div>
}
