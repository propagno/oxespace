import { i18n } from '../i18n'
import { toast } from './Toast'

/** Copies text and says what happened, so a copy button never fails silently. `what` names it in the interface language. */
export async function copyText(text: string, what: string = i18n.t('ui.copy.text')): Promise<boolean> {
  let copied = false
  try { copied = (await window.oxe?.clipboard?.writeText(text)) ?? false } catch { /* the browser clipboard is tried next */ }
  if (!copied) { try { await navigator.clipboard.writeText(text); copied = true } catch { /* reported below */ } }
  if (copied) toast({ title: i18n.t('ui.copy.done', { what }), intent: 'success', duration: 2000 })
  else toast({ title: i18n.t('ui.copy.failed', { what }), description: i18n.t('ui.copy.unavailable'), intent: 'danger' })
  return copied
}
