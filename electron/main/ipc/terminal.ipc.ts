import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import {
  parseTerminalResizeInput,
  parseTerminalStartInput,
  parseTerminalStopInput,
  parseTerminalWriteInput
} from './validation'

export interface TerminalIpcController {
  start(input: ReturnType<typeof parseTerminalStartInput>): Promise<void> | void
  write(input: ReturnType<typeof parseTerminalWriteInput>): Promise<void> | void
  resize(input: ReturnType<typeof parseTerminalResizeInput>): Promise<void> | void
  stop(input: ReturnType<typeof parseTerminalStopInput>): Promise<void> | void
  restart(input: ReturnType<typeof parseTerminalStopInput>): Promise<void> | void
  hasSession?(paneId: string): boolean
}

export function registerTerminalIpc(controller: TerminalIpcController = createPendingTerminalController()): void {
  ipcMain.handle(IPC_CHANNELS.terminal.start, (_event, input: unknown) => controller.start(parseTerminalStartInput(input)))
  ipcMain.handle(IPC_CHANNELS.terminal.write, (_event, input: unknown) => controller.write(parseTerminalWriteInput(input)))
  ipcMain.handle(IPC_CHANNELS.terminal.resize, (_event, input: unknown) => controller.resize(parseTerminalResizeInput(input)))
  ipcMain.handle(IPC_CHANNELS.terminal.stop, (_event, input: unknown) => controller.stop(parseTerminalStopInput(input)))
  ipcMain.handle(IPC_CHANNELS.terminal.restart, (_event, input: unknown) => controller.restart(parseTerminalStopInput(input)))
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
    restart: pending
  }
}
