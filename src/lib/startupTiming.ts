import { useEffect } from 'react'

let reported = false

/**
 * Closes the startup timeline once the first screen has painted: a renderer `oxe:interactive` mark (offset
 * from navigation start) and a report to the main process, which times it from process start.
 *
 * Renders nothing. Placed after <App /> so its effect runs once the first tree has committed; the second
 * animation frame lands after that commit has been painted.
 */
export function StartupInteractiveMark(): null {
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        // Set here, not when the effect runs: StrictMode's dev remount cancels the first pair of frames.
        if (reported) return
        reported = true
        performance.mark('oxe:interactive')
        void window.oxe?.diagnostics?.reportInteractive?.().catch(() => undefined)
      })
    })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [])
  return null
}
