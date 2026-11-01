import { Smartphone } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button, toast } from '../../ui'
import { i18n } from '../../i18n'
import { remoteApi, useRemoteGateway, useRemoteStore } from '../../store/remote.store'
import styles from './PanePhoneWrite.module.css'
import paneMenu from './PaneMenu.module.css'

const tc = i18n.getFixedT(null, 'code')

/** Whether a paired phone may type into this pane: the person's choice on the desktop, off again when the app restarts. */
export function usePhoneWrite(paneId: string): { allowed: boolean; offered: boolean } {
  useRemoteGateway()
  const status = useRemoteStore(state => state.status)
  const allowed = !!status?.phoneWritePanes.includes(paneId)
  // Offered while the phone connection is on, and always to turn it back off.
  return { allowed, offered: allowed || !!status?.enabled }
}

export async function setPhoneWrite(paneId: string, allowed: boolean): Promise<void> {
  const api = remoteApi()
  if (!api) return
  try { useRemoteStore.getState().apply({ status: await api.setPhoneWrite({ paneId, allowed }) }) } catch (cause) {
    toast({ title: tc('paneMenu.phoneWriteFailed'), description: cause instanceof Error ? cause.message : String(cause), intent: 'danger' })
  }
}

/** The pane header's sign that a phone can type here. */
export function PhoneWriteBadge(): ReactElement {
  return <span className={styles.badge} role="status" title={tc('paneMenu.phoneWriteBadgeTitle')} data-testid="pane-phone-write">
    <Smartphone size={12} aria-hidden="true" /><span className={styles.label}>{tc('paneMenu.phoneWriteBadge')}</span>
  </span>
}

/** The ⋯ menu entry that turns typing from the phone on or off for one terminal. */
export function PhoneWriteMenuItem({ paneId, allowed, onDone }: { paneId: string; allowed: boolean; onDone: (action: () => void) => void }): ReactElement {
  return <Button variant="ghost" role="menuitemcheckbox" aria-checked={allowed} className={paneMenu.item} data-testid="pane-phone-write-toggle"
    onClick={event => { event.stopPropagation(); onDone(() => { void setPhoneWrite(paneId, !allowed) }) }}>
    <Smartphone size={14} aria-hidden="true" />{tc('paneMenu.phoneWrite')}<span className={styles.check} aria-hidden="true">{allowed ? '✓' : ''}</span>
  </Button>
}
