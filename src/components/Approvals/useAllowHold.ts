import { useEffect, useState } from 'react'
import { APPROVAL_CRITICAL_ALLOW_DELAY_MS } from '../../../shared/types/approvals'

/**
 * Milliseconds left before allow buttons unlock at critical risk (0 once they are available, or when not held).
 * Restarts for each new request (`instance`). Timed with performance.now(): monotonic, and not frozen by a fixed
 * clock (e2e) or moved by a clock change. Shared by the approval modal and the conversation's approval card.
 */
export function useAllowHold(held: boolean, instance: string, delayMs: number = APPROVAL_CRITICAL_ALLOW_DELAY_MS): number {
  const [hold, setHold] = useState({ instance, left: held ? delayMs : 0 })
  useEffect(() => {
    if (!held || delayMs <= 0) { setHold({ instance, left: 0 }); return }
    const started = performance.now()
    setHold({ instance, left: delayMs })
    const timer = setInterval(() => {
      const left = Math.max(0, delayMs - (performance.now() - started))
      setHold({ instance, left })
      if (!left) clearInterval(timer)
    }, 100)
    return () => clearInterval(timer)
  }, [held, instance, delayMs])
  // A new request renders before its effect runs: it starts held, never with the previous request's countdown.
  return hold.instance === instance ? hold.left : held ? delayMs : 0
}
