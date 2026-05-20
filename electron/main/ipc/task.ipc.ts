import { BrowserWindow, ipcMain } from 'electron'
import type { AppDatabase } from '../db/index'
import type { TerminalIpcController } from './terminal.ipc'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { TaskService } from '../services/task.service'
import {
  parseId,
  parseTaskCreateInput,
  parseTaskReorderInput,
  parseTaskRunInput,
  parseTaskUpdateInput,
  parseTaskVerifyInput
} from './validation'

export function registerTaskIpc(db: AppDatabase, terminal: TerminalIpcController): void {
  const taskService = new TaskService(db, {
    isTerminalRunning: (paneId) => 'hasSession' in terminal && typeof terminal.hasSession === 'function' && terminal.hasSession(paneId),
    terminalWrite: (input) => terminal.write(input),
    emitVerifyOutput: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.tasks.onVerifyOutput, event)
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.tasks.list, (_event, workspaceId: unknown) => taskService.list(parseId(workspaceId, 'workspaceId')))
  ipcMain.handle(IPC_CHANNELS.tasks.create, (_event, input: unknown) => taskService.create(parseTaskCreateInput(input)))
  ipcMain.handle(IPC_CHANNELS.tasks.update, (_event, id: unknown, input: unknown) =>
    taskService.update(parseId(id, 'taskId'), parseTaskUpdateInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.tasks.delete, (_event, id: unknown) => taskService.delete(parseId(id, 'taskId')))
  ipcMain.handle(IPC_CHANNELS.tasks.reorder, (_event, input: unknown) => taskService.reorder(parseTaskReorderInput(input)))
  ipcMain.handle(IPC_CHANNELS.tasks.run, (_event, input: unknown) => taskService.run(parseTaskRunInput(input)))
  ipcMain.handle(IPC_CHANNELS.tasks.verify, (_event, input: unknown) => taskService.verify(parseTaskVerifyInput(input)))
  ipcMain.handle(IPC_CHANNELS.tasks.executions, (_event, taskId: unknown) => taskService.executions(parseId(taskId, 'taskId')))
  ipcMain.handle(IPC_CHANNELS.tasks.addDependency, (_event, input: unknown) => {
    const { taskId, dependsOnTaskId } = parseDependencyInput(input)
    return taskService.addDependency(taskId, dependsOnTaskId)
  })
  ipcMain.handle(IPC_CHANNELS.tasks.removeDependency, (_event, input: unknown) => {
    const { taskId, dependsOnTaskId } = parseDependencyInput(input)
    return taskService.removeDependency(taskId, dependsOnTaskId)
  })
  ipcMain.handle(IPC_CHANNELS.tasks.getReady, (_event, workspaceId: unknown) =>
    taskService.getReadyTaskIds(parseId(workspaceId, 'workspaceId'))
  )
}

function parseDependencyInput(value: unknown): { taskId: string; dependsOnTaskId: string } {
  if (!value || typeof value !== 'object') throw new Error('Invalid dependency input')
  const { taskId, dependsOnTaskId } = value as { taskId?: unknown; dependsOnTaskId?: unknown }
  if (typeof taskId !== 'string' || !taskId) throw new Error('taskId is required')
  if (typeof dependsOnTaskId !== 'string' || !dependsOnTaskId) throw new Error('dependsOnTaskId is required')
  return { taskId, dependsOnTaskId }
}
