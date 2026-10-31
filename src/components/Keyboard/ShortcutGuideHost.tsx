import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react'
import { getKeyboardView, useKeybindings, type AppView } from '../../keyboard/keybindings'

const ShortcutGuide = lazy(() => import('./ShortcutGuide').then(module => ({ default: module.ShortcutGuide })))

/** Event the palette and menus send to open the guide. */
export const OPEN_SHORTCUT_GUIDE_EVENT = 'oxe:open-shortcut-guide'

/** Opens the shortcut guide with ? or Ctrl+/ outside text fields. The dialog loads on first use. */
export function ShortcutGuideHost(): ReactElement | null {
  const [view, setView] = useState<AppView | null>(null)
  const open = (): void => setView(getKeyboardView())
  useKeybindings({ 'help.shortcuts': open })
  useEffect(() => {
    window.addEventListener(OPEN_SHORTCUT_GUIDE_EVENT, open)
    return () => window.removeEventListener(OPEN_SHORTCUT_GUIDE_EVENT, open)
  }, [])
  if (!view) return null
  return <Suspense fallback={null}><ShortcutGuide view={view} onClose={() => setView(null)} /></Suspense>
}
