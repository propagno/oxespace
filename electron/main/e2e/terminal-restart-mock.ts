/**
 * B17 · terminal.restart in E2E runs: nothing restarts, and every valid request is recorded with its resume flag,
 * after the same validation as the main process:
 *
 *   await app.evaluate(() => globalThis.__oxeTerminalRestarts)   // [{ paneId }, { paneId, resume: false }, …] in order
 */
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { parseTerminalRestartInput } from '../ipc/validation'

export const E2E_TERMINAL_RESTARTS_GLOBAL = '__oxeTerminalRestarts'

export function registerTerminalRestartMock(scope: Record<string, unknown>): void {
  ipcMain.handle(IPC_CHANNELS.terminal.restart, (_event, input: unknown) => {
    const { paneId, resume } = parseTerminalRestartInput(input)
    const restarts = (scope[E2E_TERMINAL_RESTARTS_GLOBAL] ??= []) as Array<{ paneId: string; resume?: false }>
    restarts.push(resume === false ? { paneId, resume } : { paneId })
  })
}
