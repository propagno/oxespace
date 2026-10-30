import { i18n, loadNamespace, useNamespace } from '../../i18n'
import { formatNumber } from '../../utils/formatTime'
import { toast } from '../../ui/Toast'

/** OxeQuery's text outside components (models, palette, toasts), in the language on screen when it is called. */
export const tq = i18n.getFixedT(null, 'oxequery')

let loading: Promise<void> | null = null

/** Loads OxeQuery's catalog; it is not part of the boot bundle. */
export function loadOxeQueryCatalog(): Promise<void> {
  return (loading ??= loadNamespace('oxequery'))
}

/**
 * The view and the sidebar call this first: the first render waits (in App's Suspense) for the catalog,
 * so no key ever shows in place of its text.
 */
export function useOxeQueryCatalog(): void {
  useNamespace('oxequery')
}

/** Copies text and says so in the language on screen (`what` names it: "Error", "Results"…). */
export async function copyText(text: string, what: string): Promise<boolean> {
  let copied = false
  try { copied = (await window.oxe?.clipboard?.writeText(text)) ?? false } catch { /* the browser clipboard is tried next */ }
  if (!copied) { try { await navigator.clipboard.writeText(text); copied = true } catch { /* reported below */ } }
  toast(copied ? { title: tq('copy.done', { what }), intent: 'success', duration: 2000 } : { title: tq('copy.failed', { what }), description: tq('copy.unavailable'), intent: 'danger' })
  return copied
}

/** A byte count as B, KB, MB or GB, with the decimal separator of the language on screen. */
export function formatBytes(value: number): string {
  if (value < 1024) return `${formatNumber(value)} B`
  const [size, unit] = value < 1024 ** 2 ? [value / 1024, 'KB'] : value < 1024 ** 3 ? [value / 1024 ** 2, 'MB'] : [value / 1024 ** 3, 'GB']
  const digits = unit === 'GB' ? 2 : 1
  return `${formatNumber(size, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${unit}`
}

/** A duration measured in milliseconds, as the server reported it. */
export function formatMs(value: number, digits = 0): string {
  return `${formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ms`
}
