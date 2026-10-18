import { toast } from './Toast'

/** Copies text and says what happened, so a copy button never fails silently. */
export async function copyText(text: string, what = 'Text'): Promise<boolean> {
  let copied = false
  try { copied = (await window.oxe?.clipboard?.writeText(text)) ?? false } catch { /* the browser clipboard is tried next */ }
  if (!copied) { try { await navigator.clipboard.writeText(text); copied = true } catch { /* reported below */ } }
  if (copied) toast({ title: `${what} copied`, intent: 'success', duration: 2000 })
  else toast({ title: `Could not copy ${what.toLowerCase()}`, description: 'The clipboard is not available.', intent: 'danger' })
  return copied
}
