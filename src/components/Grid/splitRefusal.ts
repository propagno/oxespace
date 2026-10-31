import { i18n } from '../../i18n'
import { toast } from '../../ui'

/** A split the layout has no room for (every slot taken, or the largest preset reached) is told, not dropped. */
export function reportSplitRefused(cause: unknown): void {
  console.warn('[OXESpace] split refused', cause)
  toast({ title: i18n.t('pane.splitRefused.title', { ns: 'code' }), description: i18n.t('pane.splitRefused.hint', { ns: 'code' }), intent: 'warning' })
}
