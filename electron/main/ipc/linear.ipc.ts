import { ipcMain } from 'electron'
import type { AppDatabase } from '../db/index'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { GitHubService } from '../services/github.service'
import { LinearService } from '../services/linear.service'
import {
  parseLinearIssueIdInput,
  parseLinearListIssuesInput,
  parseLinearSetApiKeyInput,
  parseLinearWorktreeFromIssueInput
} from './validation'

export function registerLinearIpc(
  db: AppDatabase,
  gitHubService: GitHubService,
  service = new LinearService(db, gitHubService)
): LinearService {
  ipcMain.handle(IPC_CHANNELS.linear.getStatus, () => service.getStatus())
  ipcMain.handle(IPC_CHANNELS.linear.setApiKey, (_event, input: unknown) =>
    service.setApiKey(parseLinearSetApiKeyInput(input).apiKey)
  )
  ipcMain.handle(IPC_CHANNELS.linear.clearApiKey, () => {
    service.clearApiKey()
  })
  ipcMain.handle(IPC_CHANNELS.linear.listTeams, () => service.listTeams())
  ipcMain.handle(IPC_CHANNELS.linear.listIssues, (_event, input: unknown) =>
    service.listIssues(parseLinearListIssuesInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.linear.getIssue, (_event, input: unknown) =>
    service.getIssue(parseLinearIssueIdInput(input).issueId)
  )
  ipcMain.handle(IPC_CHANNELS.linear.createWorktreeFromIssue, (_event, input: unknown) =>
    service.createWorktreeFromIssue(parseLinearWorktreeFromIssueInput(input))
  )

  return service
}
