import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'

/** 1.5.0 · The grid a phone holds for a pane while it has the terminal open. */
export interface HeldGrid { cols: number; rows: number }

/**
 * One fit of the view. Without a hold, the terminal takes the pane's grid and reports it when it changed. While a phone
 * holds the size, the terminal takes the phone's grid and the pane's own fit is only reported, so main knows what to
 * put back. Returns whether the terminal's grid changed.
 */
export function fitTerminalGrid(terminal: Terminal, fitAddon: FitAddon, held: HeldGrid | null, notified: HeldGrid, report: (cols: number, rows: number) => void): boolean {
  if (held) {
    const own = fitAddon.proposeDimensions()
    if (own && Number.isFinite(own.cols) && Number.isFinite(own.rows) && (own.cols !== notified.cols || own.rows !== notified.rows)) {
      notified.cols = own.cols
      notified.rows = own.rows
      report(own.cols, own.rows)
    }
    const changed = terminal.cols !== held.cols || terminal.rows !== held.rows
    if (changed) terminal.resize(held.cols, held.rows)
    return changed
  }
  const before = { cols: terminal.cols, rows: terminal.rows }
  fitAddon.fit()
  const unreported = terminal.cols !== notified.cols || terminal.rows !== notified.rows
  if (unreported) {
    notified.cols = terminal.cols
    notified.rows = terminal.rows
    report(terminal.cols, terminal.rows)
  }
  // When a hold ends the grid changes back to a size main already has: still a change for the view to redraw.
  return unreported || terminal.cols !== before.cols || terminal.rows !== before.rows
}

/**
 * Keeps the held grid where the fit reads it, and fits again when the hold starts, changes or ends. A phone's grid can
 * be taller than the pane: the view scrolls then, and starts at the bottom, where the prompt is.
 */
export function useHeldGrid(held: HeldGrid | null | undefined, hostRef: RefObject<HTMLElement | null>, refitRef: MutableRefObject<(() => void) | null>): MutableRefObject<HeldGrid | null> {
  const heldRef = useRef<HeldGrid | null>(held ?? null)
  const cols = held?.cols ?? 0, rows = held?.rows ?? 0
  useEffect(() => {
    heldRef.current = cols && rows ? { cols, rows } : null
    refitRef.current?.()
    const host = hostRef.current
    if (!host || !heldRef.current) return
    const frame = window.requestAnimationFrame(() => { host.scrollTop = host.scrollHeight })
    return () => window.cancelAnimationFrame(frame)
  }, [cols, rows, hostRef, refitRef])
  return heldRef
}
