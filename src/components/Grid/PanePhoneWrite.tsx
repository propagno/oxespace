import { Check, EyeOff, Smartphone } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button, toast } from '../../ui'
import { i18n } from '../../i18n'
import { remoteApi, useRemoteGateway, useRemoteStore } from '../../store/remote.store'
import styles from './PanePhoneWrite.module.css'
import paneMenu from './PaneMenu.module.css'

const tc = i18n.getFixedT(null, 'code')

/**
 * What the phone may do with this pane: see it (CR-34 "Show on phone", on by default) and type into it (the person's
 * choice on the desktop, off again when the app restarts, and never while the pane is hidden).
 */
export function usePhoneWrite(paneId: string): { allowed: boolean; hidden: boolean; enabled: boolean; offered: boolean } {
  useRemoteGateway()
  const status = useRemoteStore(state => state.status)
  const allowed = !!status?.phoneWritePanes.includes(paneId)
  const hidden = !!status?.phoneHiddenPanes?.includes(paneId)
  const enabled = !!status?.enabled
  // Offered while the phone connection is on, and always to turn a choice back.
  return { allowed, hidden, enabled, offered: allowed || hidden || enabled }
}

export async function setPhoneWrite(paneId: string, allowed: boolean): Promise<void> {
  const api = remoteApi()
  if (!api) return
  try { useRemoteStore.getState().apply({ status: await api.setPhoneWrite({ paneId, allowed }) }) } catch (cause) {
    toast({ title: tc('paneMenu.phoneWriteFailed'), description: cause instanceof Error ? cause.message : String(cause), intent: 'danger' })
  }
}

/** CR-34: hides the pane from the phone or shows it again; main drops typing from a hidden pane. */
export async function setPhoneHidden(paneId: string, hidden: boolean): Promise<void> {
  const api = remoteApi()
  if (!api?.setPhoneHidden) return
  try { useRemoteStore.getState().apply({ status: await api.setPhoneHidden({ paneId, hidden }) }) } catch (cause) {
    toast({ title: tc('paneMenu.phoneShowFailed'), description: cause instanceof Error ? cause.message : String(cause), intent: 'danger' })
  }
}

/** The pane header's sign that a phone can type here. */
export function PhoneWriteBadge(): ReactElement {
  return <span className={styles.badge} role="status" title={tc('paneMenu.phoneWriteBadgeTitle')} data-testid="pane-phone-write">
    <Smartphone size={12} aria-hidden="true" /><span className={styles.label}>{tc('paneMenu.phoneWriteBadge')}</span>
  </span>
}

/** The pane header's phone slot: "Hidden from the phone" while hidden and the connection is on, else the typing pill. */
export function PanePhoneHeaderMark({ paneId }: { paneId: string }): ReactElement | null {
  const phone = usePhoneWrite(paneId)
  if (phone.hidden) {
    if (!phone.enabled) return null
    const label = tc('paneMenu.phoneHiddenMark')
    return <span className={styles.hiddenMark} role="img" aria-label={label} title={label} data-testid="pane-phone-hidden">
      <EyeOff size={12} aria-hidden="true" />
    </span>
  }
  return phone.allowed ? <PhoneWriteBadge /> : null
}

/** The ⋯ menu entry that turns typing from the phone on or off for one terminal. */
export function PhoneWriteMenuItem({ paneId, allowed, onDone, disabled = false, describedBy, hint }: { paneId: string; allowed: boolean; onDone: (action: () => void) => void; disabled?: boolean; describedBy?: string; hint?: string }): ReactElement {
  return <Button variant="ghost" role="menuitemcheckbox" aria-checked={allowed} aria-describedby={describedBy} disabled={disabled} className={paneMenu.item} data-testid="pane-phone-write-toggle"
    onClick={event => { event.stopPropagation(); if (disabled) return; onDone(() => { void setPhoneWrite(paneId, !allowed) }) }}>
    <Smartphone size={14} aria-hidden="true" />
    <span className={styles.itemText}>
      <span>{tc('paneMenu.phoneWrite')}</span>
      {hint ? <small className={styles.hint}>{hint}</small> : null}
    </span>
    {allowed ? <Check size={14} className={paneMenu.check} aria-hidden="true" /> : null}
  </Button>
}

/** CR-34: the ⋯ menu's phone group: Show on phone, then Allow typing from the phone, gated by it. */
export function PanePhoneMenuItems({ paneId, onDone }: { paneId: string; onDone: (action: () => void) => void }): ReactElement | null {
  const phone = usePhoneWrite(paneId)
  if (!phone.offered) return null
  const shown = !phone.hidden
  return <>
    <Button variant="ghost" role="menuitemcheckbox" aria-checked={shown} className={paneMenu.item} data-testid="pane-phone-show-toggle"
      onClick={event => { event.stopPropagation(); onDone(() => { void setPhoneHidden(paneId, shown) }) }}>
      <Smartphone size={14} aria-hidden="true" />
      <span className={styles.itemText}>
        <span>{tc('paneMenu.phoneShow')}</span>
        {shown ? <small className={styles.hint}>{tc('paneMenu.phoneShowHint')}</small> : null}
      </span>
      {shown ? <Check size={14} className={paneMenu.check} aria-hidden="true" /> : null}
    </Button>
    <PhoneWriteMenuItem paneId={paneId} allowed={phone.allowed && shown} disabled={!shown} hint={!shown ? tc('paneMenu.phoneWriteNeedsShow') : undefined} onDone={onDone} />
  </>
}
