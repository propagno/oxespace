import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TerminalView } from '../../src/components/Terminal/TerminalView'

const terminalState = {
  onData: null as ((data: string) => void) | null,
  write: vi.fn(),
  focus: vi.fn(),
  dispose: vi.fn()
}

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    cols: 120,
    rows: 32,
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: terminalState.write,
    focus: terminalState.focus,
    dispose: terminalState.dispose,
    onData: vi.fn((handler: (data: string) => void) => {
      terminalState.onData = handler
      return { dispose: vi.fn() }
    })
  }))
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn()
  }))
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn()
}))

describe('TerminalView', () => {
  beforeEach(() => {
    terminalState.onData = null
    terminalState.write.mockClear()
    terminalState.focus.mockClear()
    terminalState.dispose.mockClear()

    global.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(): void {
        this.callback([], this as unknown as ResizeObserver)
      }
      disconnect(): void {}
      unobserve(): void {}
      takeRecords(): ResizeObserverEntry[] {
        return []
      }
    }

    window.oxe = {
      app: { version: '0.1.0' },
      workspace: {
        list: vi.fn(),
        create: vi.fn(),
        setActive: vi.fn(),
        delete: vi.fn(),
        closePane: vi.fn(),
        pickFolder: vi.fn(),
        shellProfiles: vi.fn()
      },
      terminal: {
        start: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
        onData: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn())
      }
    }
  })

  test('wires xterm input, resize and terminal events', () => {
    const onInput = vi.fn()
    const onExit = vi.fn()
    const onResize = vi.fn()

    render(<TerminalView paneId="pane-1" isRunning onExit={onExit} onInput={onInput} onResize={onResize} />)

    expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
    expect(onResize).toHaveBeenCalledWith(120, 32)

    terminalState.onData?.('a')
    expect(onInput).toHaveBeenCalledWith('a')

    const dataListener = vi.mocked(window.oxe.terminal.onData).mock.calls[0][0]
    dataListener({ paneId: 'pane-1', data: 'hello' })
    expect(terminalState.write).toHaveBeenCalledWith('hello')

    const exitListener = vi.mocked(window.oxe.terminal.onExit).mock.calls[0][0]
    exitListener({ paneId: 'pane-1', exitCode: 0 })
    expect(onExit).toHaveBeenCalledWith(0)
    expect(terminalState.focus).toHaveBeenCalled()
  })
})
