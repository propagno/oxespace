import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { OxeGraphService } from '../services/oxe-graph.service'
import { parseOxeWorkspaceInput } from './validation'

export function registerOxeGraphIpc(service = new OxeGraphService()): OxeGraphService {
  ipcMain.handle(IPC_CHANNELS.oxe.getGraph, (_event, input: unknown) => {
    const parsed = parseOxeWorkspaceInput(input)
    const graph = service.buildGraph(parsed.rootPath)

    service.watchGraph(parsed.rootPath, (updated) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC_CHANNELS.oxe.onGraphUpdate, updated)
      }
    })

    return graph
  })

  return service
}
