import type { AppView } from '../keyboard/keybindings'
import { useNavigationPrefs } from '../store/navigation-prefs.store'

const START_VIEW = 'oxe.start-view'

/**
 * CR-F8-Triad (10/11): OxeChat ('thread') is the cold-start home screen and
 * fallback for removed views ('post', 'pods', 'agora'), while valid triad
 * views ('code' | 'thread' | 'data') are respected.
 */
export function initialAppView(remembered: string | null): AppView {
  if (remembered === 'code' || remembered === 'thread' || remembered === 'data') return remembered
  return 'thread'
}

/**
 * Resolves the initial AppView at window boot. Until first-run has an agent
 * ready or is dismissed (with no remembered view yet), OXESpace opens on
 * first-run ('code'); afterwards it delegates to initialAppView.
 */
export function startAppView(): AppView {
  let remembered: string | null
  try { remembered = localStorage.getItem(START_VIEW) } catch { remembered = null }
  if (remembered === 'code' || remembered === 'thread' || remembered === 'data') return remembered
  const { firstRun } = useNavigationPrefs.getState()
  const firstRunReady = firstRun.dismissed || (['agents', 'account', 'folder'] as const).every(step => firstRun.done.includes(step))
  if (!firstRunReady && remembered === null) return 'code'
  return initialAppView(remembered)
}

export function rememberAppView(view: AppView): void {
  try { localStorage.setItem(START_VIEW, view) } catch { /* storage unavailable */ }
}
