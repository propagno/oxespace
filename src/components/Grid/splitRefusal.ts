import { i18n } from '../../i18n'
import { toast } from '../../ui'
import { MIN_PANE_HEIGHT_PX, MIN_PANE_WIDTH_PX } from './splitRoom'

/** A split the layout has no room for (every slot taken, or the largest preset reached) is told, not dropped. */
export function reportSplitRefused(cause: unknown): void {
  console.warn('[OXESpace] split refused', cause)
  toast({ title: i18n.t('pane.splitRefused.title', { ns: 'code' }), description: i18n.t('pane.splitRefused.hint', { ns: 'code' }), intent: 'warning' })
}

/** A split whose halves would be too small to use is refused before any pane is created, and said. */
export function reportSplitTooSmall(direction: 'vertical' | 'horizontal'): void {
  toast({
    title: i18n.t('pane.splitRefused.title', { ns: 'code' }),
    description: i18n.t(direction === 'vertical' ? 'pane.splitRefused.tooNarrow' : 'pane.splitRefused.tooShort', { ns: 'code', width: MIN_PANE_WIDTH_PX, height: MIN_PANE_HEIGHT_PX }),
    intent: 'warning'
  })
}
