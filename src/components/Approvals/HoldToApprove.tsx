import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'
import { Button } from '../../ui'
import styles from './Approvals.module.css'

export const IMPACT_HOLD_MS = 1_200
const COUNTDOWN_TICK_MS = 100

function isHoldKey(key: string): boolean {
  return key === ' ' || key === 'Enter' || key === 'a' || key === 'A'
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches)
}

export function HoldToApprove({
  label,
  shortcut,
  onComplete,
  disabled = false
}: {
  label: string
  shortcut?: string
  onComplete: () => void
  disabled?: boolean
}): ReactElement {
  const [holding, setHolding] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [remainingMs, setRemainingMs] = useState<number | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  const clearTimers = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const cancelHold = useCallback((): void => {
    if (!activeRef.current) return
    activeRef.current = false
    clearTimers()
    setHolding(false)
    setRemainingMs(null)
  }, [clearTimers])

  const startHold = useCallback((): void => {
    if (disabled || activeRef.current) return
    activeRef.current = true
    const isReduced = prefersReducedMotion()
    setReduced(isReduced)
    setHolding(true)

    const startedAt = Date.now()
    if (isReduced) {
      setRemainingMs(IMPACT_HOLD_MS)
      intervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAt
        setRemainingMs(Math.max(0, IMPACT_HOLD_MS - elapsed))
      }, COUNTDOWN_TICK_MS)
    } else {
      setRemainingMs(null)
    }

    timerRef.current = setTimeout(() => {
      activeRef.current = false
      clearTimers()
      setHolding(false)
      setRemainingMs(null)
      onCompleteRef.current()
    }, IMPACT_HOLD_MS)
  }, [clearTimers, disabled])

  useEffect(() => {
    if (disabled) cancelHold()
  }, [disabled, cancelHold])

  useEffect(() => () => clearTimers(), [clearTimers])

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    startHold()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!isHoldKey(event.key)) return
    event.preventDefault()
    if (event.repeat) return
    startHold()
  }

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!isHoldKey(event.key)) return
    event.preventDefault()
    cancelHold()
  }

  const countdown = holding && reduced && remainingMs !== null
    ? `${(Math.max(0, remainingMs) / 1000).toFixed(1)} s`
    : null

  return (
    <div className={styles.holdWrap}>
      <Button
        variant="danger"
        disabled={disabled}
        data-holding={holding || undefined}
        onPointerDown={handlePointerDown}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onPointerLeave={cancelHold}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={cancelHold}
      >
        {label}
        {shortcut ? <kbd aria-hidden="true" className={styles.kbdHint}>{shortcut}</kbd> : null}
      </Button>
      {countdown ? <span aria-live="off" className={styles.holdCountdown}>{countdown}</span> : null}
    </div>
  )
}
