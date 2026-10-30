import { app, BrowserWindow, ipcMain } from 'electron'
import { requireAppFrame } from './ipc-guards'
import { TERMINAL_PRESENCE_STATES, type TerminalPresenceInput } from '../../../shared/types/ipc/terminal'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import {
  parseTerminalAttachInput,
  parseTerminalResizeInput,
  parseTerminalStartInput,
  parseTerminalStopInput,
  parseTerminalWriteInput
} from './validation'
import type { TerminalAttachResult, TerminalStatusResult } from '../../../shared/types/ipc'

export interface TerminalIpcController {
  start(input: ReturnType<typeof parseTerminalStartInput>): Promise<void> | void
  write(input: ReturnType<typeof parseTerminalWriteInput>): Promise<void> | void
  resize(input: ReturnType<typeof parseTerminalResizeInput>): Promise<void> | void
  stop(input: ReturnType<typeof parseTerminalStopInput>): Promise<void> | void
  restart(input: ReturnType<typeof parseTerminalStopInput>): Promise<void> | void
  attach(input: ReturnType<typeof parseTerminalAttachInput>): TerminalAttachResult
  detach(input: ReturnType<typeof parseTerminalStopInput>): void
  status(paneId: string): TerminalStatusResult
  hasSession?(paneId: string): boolean
  setPresence?(input: TerminalPresenceInput): void
  setWindowFocused?(focused: boolean): void
}

export function registerTerminalIpc(controller: TerminalIpcController = createPendingTerminalController()): void {
  ipcMain.handle(IPC_CHANNELS.terminal.start, (_event, input: unknown) => controller.start(parseTerminalStartInput(input)))
  ipcMain.handle(IPC_CHANNELS.terminal.write, (_event, input: unknown) => controller.write(parseTerminalWriteInput(input)))
  ipcMain.handle(IPC_CHANNELS.terminal.resize, (_event, input: unknown) => controller.resize(parseTerminalResizeInput(input)))
  ipcMain.handle(IPC_CHANNELS.terminal.stop, (_event, input: unknown) => controller.stop(parseTerminalStopInput(input)))
  ipcMain.handle(IPC_CHANNELS.terminal.restart, (_event, input: unknown) => controller.restart(parseTerminalStopInput(input)))
  // attach must stay synchronous inside the handler: it flushes, snapshots and
  // flips the attached flag in one tick so no output is duplicated or lost.
  ipcMain.handle(IPC_CHANNELS.terminal.attach, (_event, input: unknown) => controller.attach(parseTerminalAttachInput(input)))
  ipcMain.handle(IPC_CHANNELS.terminal.detach, (_event, input: unknown) => controller.detach(parseTerminalStopInput(input)))
  ipcMain.handle(IPC_CHANNELS.terminal.status, (_event, paneId: unknown) => controller.status(String(paneId ?? '')))
  ipcMain.handle(IPC_CHANNELS.terminal.setPresence, (event, input: unknown) => {
    requireAppFrame(event, 'Terminal presence')
    controller.setPresence?.(parseTerminalPresenceInput(input))
  })
  // A focused pane is drawn at the visible pace while no app window has the system focus (B2.3).
  app.on('browser-window-focus', () => controller.setWindowFocused?.(true))
  app.on('browser-window-blur', () => setTimeout(() => controller.setWindowFocused?.(BrowserWindow.getFocusedWindow() !== null), 0))
}

/** `{ paneId, state }` with a known state and nothing else. */
export function parseTerminalPresenceInput(value: unknown): TerminalPresenceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid terminal presence')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => key !== 'paneId' && key !== 'state')) throw new Error('Unknown terminal presence field')
  if (typeof input.paneId !== 'string' || !input.paneId || input.paneId.length > 200) throw new Error('Invalid terminal presence pane')
  if (!(TERMINAL_PRESENCE_STATES as readonly unknown[]).includes(input.state)) throw new Error('Invalid terminal presence state')
  return { paneId: input.paneId, state: input.state as TerminalPresenceInput['state'] }
}

export function createPendingTerminalController(): TerminalIpcController {
  const pending = (): never => {
    throw new Error('TerminalManager is not implemented yet; execute T6 before starting terminals')
  }

  return {
    start: pending,
    write: pending,
    resize: pending,
    stop: pending,
    restart: pending,
    attach: pending,
    detach: pending,
    status: pending
  }
}
