import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { SearchService } from '../services/search.service'
import { parseSearchInput } from './validation'

export function registerSearchIpc(service = new SearchService()): SearchService {
  ipcMain.handle(IPC_CHANNELS.search.run, (_event, input: unknown) => {
    return service.search(parseSearchInput(input))
  })
  ipcMain.handle(IPC_CHANNELS.search.cancel, () => {
    service.cancel()
  })
  return service
}
