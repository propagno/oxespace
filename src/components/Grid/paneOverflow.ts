import { i18n } from '../../i18n'

export const NARROW_WINDOW_MAX_PX = 900
export const NARROW_WINDOW_MAX_PANES = 4

/** At 900 px or narrower, more than four panes show one at a time; returns the explanatory note or null. */
export function paneOverflowNote(panes: number, width: number): string | null {
  if (width <= NARROW_WINDOW_MAX_PX && panes > NARROW_WINDOW_MAX_PANES) {
    return i18n.t('pane.overflowNote', { ns: 'code', n: panes })
  }
  return null
}
