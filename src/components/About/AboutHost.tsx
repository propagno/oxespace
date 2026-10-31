import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react'

const AboutDialog = lazy(() => import('./AboutDialog').then(module => ({ default: module.AboutDialog })))

/** Event the palette and the Help menu send to open About OXESpace. */
export const OPEN_ABOUT_EVENT = 'oxe:open-about'

/** Mounts About OXESpace on request. Its code loads the first time it is opened. */
export function AboutHost(): ReactElement | null {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = (): void => setOpen(true)
    window.addEventListener(OPEN_ABOUT_EVENT, show)
    return () => window.removeEventListener(OPEN_ABOUT_EVENT, show)
  }, [])
  if (!open) return null
  return <Suspense fallback={null}><AboutDialog onClose={() => setOpen(false)} /></Suspense>
}
