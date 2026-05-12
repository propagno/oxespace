import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { OxeService } from '../services/oxe.service'
import { parseOxeWorkspaceInput } from './validation'

export function registerOxeIpc(oxeService = new OxeService()): OxeService {
  ipcMain.handle(IPC_CHANNELS.oxe.getStatus, (_event, input: unknown) => oxeService.getStatus(parseOxeWorkspaceInput(input)))
  ipcMain.handle(IPC_CHANNELS.oxe.getStatusJson, (_event, input: unknown) => oxeService.getStatus(parseOxeWorkspaceInput(input)))
  ipcMain.handle(IPC_CHANNELS.oxe.listArtifacts, (_event, input: unknown) => oxeService.listArtifacts(parseOxeWorkspaceInput(input)))
  ipcMain.handle(IPC_CHANNELS.oxe.listArtifactsRich, (_event, input: unknown) => oxeService.listArtifactsRich(parseOxeWorkspaceInput(input)))
  ipcMain.handle(IPC_CHANNELS.oxe.getFreshness, (_event, input: unknown) => oxeService.getFreshness(parseOxeWorkspaceInput(input)))
  return oxeService
}
