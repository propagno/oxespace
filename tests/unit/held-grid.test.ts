import { describe, expect, it, vi } from 'vitest'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { fitTerminalGrid } from '../../src/components/Terminal/heldGrid'

/** A terminal and a fit addon reduced to what a fit touches: the pane fits `own`, the terminal has a grid. */
function view(own: { cols: number; rows: number } | undefined, grid = { cols: 80, rows: 24 }) {
  const terminal = { ...grid, resize: vi.fn((cols: number, rows: number) => { terminal.cols = cols; terminal.rows = rows }) }
  const fitAddon = { proposeDimensions: vi.fn(() => own), fit: vi.fn(() => { if (own) { terminal.cols = own.cols; terminal.rows = own.rows } }) }
  return { terminal: terminal as unknown as Terminal & { resize: ReturnType<typeof vi.fn> }, fitAddon: fitAddon as unknown as FitAddon & { fit: ReturnType<typeof vi.fn> } }
}

describe('one fit of the terminal view', () => {
  it("takes the pane's grid and reports it once when nothing holds the size", () => {
    const { terminal, fitAddon } = view({ cols: 120, rows: 30 })
    const notified = { cols: 0, rows: 0 }; const report = vi.fn()
    expect(fitTerminalGrid(terminal, fitAddon, null, notified, report)).toBe(true)
    expect([terminal.cols, terminal.rows]).toEqual([120, 30])
    expect(report).toHaveBeenCalledWith(120, 30)
    expect(fitTerminalGrid(terminal, fitAddon, null, notified, report)).toBe(false)
    expect(report).toHaveBeenCalledTimes(1)
  })

  it("takes the phone's grid while it is held, and only reports the pane's own", () => {
    const { terminal, fitAddon } = view({ cols: 120, rows: 30 })
    const notified = { cols: 0, rows: 0 }; const report = vi.fn()
    expect(fitTerminalGrid(terminal, fitAddon, { cols: 46, rows: 28 }, notified, report)).toBe(true)
    expect(terminal.resize).toHaveBeenCalledWith(46, 28)
    expect(fitAddon.fit).not.toHaveBeenCalled()
    // What main puts back when the phone lets go.
    expect(report).toHaveBeenCalledWith(120, 30)
    // The same hold again changes nothing and reports nothing.
    expect(fitTerminalGrid(terminal, fitAddon, { cols: 46, rows: 28 }, notified, report)).toBe(false)
    expect(terminal.resize).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledTimes(1)
  })

  it("goes back to the pane's grid when the hold ends, without reporting a size main already has", () => {
    const { terminal, fitAddon } = view({ cols: 120, rows: 30 })
    const notified = { cols: 0, rows: 0 }; const report = vi.fn()
    fitTerminalGrid(terminal, fitAddon, { cols: 46, rows: 28 }, notified, report)
    // The grid changed, so the view redraws; main already knows this size, so nothing is reported again.
    expect(fitTerminalGrid(terminal, fitAddon, null, notified, report)).toBe(true)
    expect([terminal.cols, terminal.rows]).toEqual([120, 30])
    expect(report).toHaveBeenCalledTimes(1)
    expect(fitTerminalGrid(terminal, fitAddon, null, notified, report)).toBe(false)
  })

  it('keeps the held grid when the pane has no size yet', () => {
    const { terminal, fitAddon } = view(undefined)
    const report = vi.fn()
    expect(fitTerminalGrid(terminal, fitAddon, { cols: 46, rows: 28 }, { cols: 0, rows: 0 }, report)).toBe(true)
    expect(report).not.toHaveBeenCalled()
  })
})
