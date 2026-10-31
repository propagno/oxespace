import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react'

const ReportProblem = lazy(() => import('./ReportProblem').then(module => ({ default: module.ReportProblem })))

/** Event the palette and the Help menu send to open the report dialog. */
export const OPEN_REPORT_PROBLEM_EVENT = 'oxe:open-report-problem'

/** Mounts the "Report a problem" dialog on request. Its code loads the first time it is opened. */
export function ReportProblemHost(): ReactElement | null {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = (): void => setOpen(true)
    window.addEventListener(OPEN_REPORT_PROBLEM_EVENT, show)
    return () => window.removeEventListener(OPEN_REPORT_PROBLEM_EVENT, show)
  }, [])
  if (!open) return null
  return <Suspense fallback={null}><ReportProblem onClose={() => setOpen(false)} /></Suspense>
}
