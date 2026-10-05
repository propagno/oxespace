import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import type { NativeAccountService, NativeAuthScope } from '../services/conversation/native-account.service'
import type { ThreadManager } from '../services/conversation/thread-manager'
import type { AppDatabase } from '../db'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { AgentService } from '../services/agent.service'
import type { AgentAccountContext } from '../../../shared/types/agentAuth'
import { MemoryProjectService } from '../services/memory/memory-project.service'
import { ThreadProjectService } from '../services/conversation/thread-projects'
import type { ThreadMcpBindings } from '../services/conversation/thread-mcp'
import type { ThreadRequestResponse } from '../../../shared/types/thread'

function string(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 65536 || value.includes('\0')) throw new Error('Invalid thread input')
  return value
}
function sender(event: IpcMainInvokeEvent): void {
  if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Thread requests require the application main frame')
}
function optionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw Error('Invalid numeric input')
  return Number(value)
}
function stringList(value: unknown, maximum: number): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximum) throw Error('Invalid list input')
  return value.map(item => string(item))
}
function requestResponse(value: unknown): ThreadRequestResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid request response')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['decision', 'answers', 'content', 'permissions', 'scope'].includes(key))) throw Error('Unknown request response field')
  const result: ThreadRequestResponse = {}
  if (input.decision !== undefined) {
    if (!['accept', 'acceptForSession', 'decline', 'cancel'].includes(String(input.decision))) throw Error('Invalid request decision')
    result.decision = input.decision as ThreadRequestResponse['decision']
  }
  if (input.scope !== undefined) {
    if (input.scope !== 'turn' && input.scope !== 'session') throw Error('Invalid permission scope')
    result.scope = input.scope
  }
  if (input.answers !== undefined) {
    if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers) || Object.keys(input.answers).length > 20) throw Error('Invalid request answers')
    result.answers = Object.fromEntries(Object.entries(input.answers as Record<string, unknown>).map(([key, answers]) => {
      if (!/^[a-z0-9_.:-]{1,120}$/i.test(key) || !Array.isArray(answers) || answers.length > 20 || answers.some(answer => typeof answer !== 'string' || Buffer.byteLength(answer) > 4096)) throw Error('Invalid request answer')
      return [key, answers as string[]]
    }))
  }
  for (const key of ['content', 'permissions'] as const) if (input[key] !== undefined) {
    if (!input[key] || typeof input[key] !== 'object' || Array.isArray(input[key]) || Buffer.byteLength(JSON.stringify(input[key])) > 64 * 1024) throw Error(`Invalid ${key}`)
    result[key] = input[key] as never
  }
  if (!Object.keys(result).length) throw Error('Empty request response')
  return result
}

export function registerThreadIpc(db: AppDatabase, mcp: ThreadMcpBindings): { stop(): Promise<void>; manager: Promise<ThreadManager> } {
  const projects = new MemoryProjectService(db)
  const threadProjects = new ThreadProjectService(db)
  // Keep account/project implementation out of the startup entry bundle.
  const accounts: Promise<NativeAccountService> = import('../services/conversation/native-account.service').then(({ NativeAccountService, authScopeId }) => new NativeAccountService({
    resolve: async (context: AgentAccountContext): Promise<NativeAuthScope> => {
      const thread = context.threadId ? (await manager).read(context.threadId).thread : null
      if (thread && (thread.workspaceId !== context.workspaceId || thread.provider !== context.provider)) throw Error('Invalid account context')
      const profiles = new AgentService(db).list()
      const selected = thread?.agentProfileId ? profiles.find(p => p.agentProfileId === thread.agentProfileId) : undefined
      const profile = selected && !selected.parentProvider ? selected : profiles.find(p => p.provider === context.provider && !p.parentProvider)
      if (!profile || (profile.parentProvider ?? profile.provider) !== context.provider) throw Error('Configure the provider in Agent Settings')
      const root = thread ? thread.rootPath : context.workspaceId.startsWith('thread:')
        ? threadProjects.context(context.workspaceId.slice('thread:'.length)).rootPath
        : (await projects.workspace(context.workspaceId, context.paneId)).cwd
      return { id: authScopeId(context.provider, profile.command, root), provider: context.provider, command: profile.command, cwd: root }
    },
    openExternal: url => shell.openExternal(url),
    changed: status => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.agentAccount.changed, status) },
    beforeLogin: async provider => {
      const service = await manager
      if (service.hasRunning(provider)) throw Error('Active turn')
      await service.refreshAccounts(provider)
    },
    connected: async provider => { await (await manager).refreshAccounts(provider) }
  }))
  const manager: Promise<ThreadManager> = import('../services/conversation/thread-runtime').then(async module => module.createThreadManager(db, await accounts, mcp))
  const accountContext = (value: unknown): AgentAccountContext => {
    if (!value || typeof value !== 'object') throw Error('Invalid account context')
    const input = value as Record<string, unknown>
    if (input.provider !== 'claude' && input.provider !== 'codex') throw Error('Invalid account provider')
    return { provider: input.provider, workspaceId: string(input.workspaceId),
      ...(input.paneId ? { paneId: string(input.paneId) } : {}), ...(input.threadId ? { threadId: string(input.threadId) } : {}) }
  }
  ipcMain.handle(IPC_CHANNELS.agentAccount.read, (event, context) => { sender(event); return accounts.then(service => service.read(accountContext(context))) })
  ipcMain.handle(IPC_CHANNELS.agentAccount.login, (event, context) => { sender(event); return accounts.then(service => service.login(accountContext(context))) })
  ipcMain.handle(IPC_CHANNELS.agentAccount.logout, (event, context) => { sender(event); return accounts.then(service => service.logout(accountContext(context))) })
  ipcMain.handle(IPC_CHANNELS.agentAccount.cancel, (event, id) => { sender(event); return accounts.then(service => service.cancel(string(id))) })
  ipcMain.handle(IPC_CHANNELS.agentAccount.code, (event, id, code) => { sender(event); return accounts.then(service => service.submitCode(string(id), string(code))) })
  ipcMain.handle(IPC_CHANNELS.agentAccount.browser, (event, id) => { sender(event); return accounts.then(service => service.openBrowser(string(id))) })
  ipcMain.handle(IPC_CHANNELS.thread.projects, event => { sender(event); return import('../services/conversation/thread-projects').then(module => module.threadProjectCatalog(db)) })
  ipcMain.handle(IPC_CHANNELS.thread.addProject, (event, rootPath: unknown) => { sender(event); return threadProjects.add(string(rootPath)) })
  ipcMain.handle(IPC_CHANNELS.thread.relinkProject, (event, projectId: unknown, rootPath: unknown) => { sender(event); return threadProjects.relink(string(projectId), string(rootPath)) })
  ipcMain.handle(IPC_CHANNELS.thread.setProjectHidden, (event, projectId: unknown, hidden: unknown) => {
    sender(event); if (typeof hidden !== 'boolean') throw Error('Invalid project visibility'); threadProjects.setHidden(string(projectId), hidden)
  })
  ipcMain.handle(IPC_CHANNELS.thread.list, event => { sender(event); return manager.then(service => service.list()) })
  ipcMain.handle(IPC_CHANNELS.thread.read, (event, id: unknown) => { sender(event); return manager.then(service => service.readForRenderer(string(id))) })
  ipcMain.handle(IPC_CHANNELS.thread.history, (event, id: unknown, before: unknown, limit: unknown) => { sender(event); return manager.then(service => service.historyPage(string(id), optionalInteger(before, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), optionalInteger(limit, 1, 500))) })
  ipcMain.handle(IPC_CHANNELS.thread.attach, (event, id: unknown, input: unknown) => {
    sender(event)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid attachment')
    const value = input as Record<string, unknown>
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(value.mimeType))) throw Error('Unsupported attachment type')
    if (!(value.data instanceof ArrayBuffer) && !ArrayBuffer.isView(value.data)) throw Error('Invalid attachment data')
    return manager.then(service => service.attach(string(id), { name: string(value.name), mimeType: value.mimeType as import('../../../shared/types/thread').ThreadAttachment['mimeType'], data: value.data as ArrayBuffer | Uint8Array }))
  })
  ipcMain.handle(IPC_CHANNELS.thread.removeAttachment, (event, id: unknown, attachmentId: unknown) => { sender(event); return manager.then(service => service.removeAttachment(string(id), string(attachmentId))) })
  ipcMain.handle(IPC_CHANNELS.thread.artifact, (event, id: unknown, artifactId: unknown) => { sender(event); return manager.then(service => service.artifact(string(id), string(artifactId))) })
  ipcMain.handle(IPC_CHANNELS.thread.exportPortable, async (event, id: unknown) => {
    sender(event)
    const service = await manager, threadId = string(id), snapshot = service.read(threadId)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Export conversation', defaultPath: `${snapshot.thread.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 80) || 'conversation'}.oxethread.json`, filters: [{ name: 'OXESpace conversation', extensions: ['json'] }] }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    sender(event)
    await writeFile(result.filePath, service.exportPortable(threadId), { encoding: 'utf8', flag: 'wx' }).catch(async error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      await writeFile(result.filePath!, service.exportPortable(threadId), 'utf8')
    })
    return result.filePath
  })
  ipcMain.handle(IPC_CHANNELS.thread.importPortable, async (event, id: unknown) => {
    sender(event)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: import('electron').OpenDialogOptions = { title: 'Import conversation', properties: ['openFile'], filters: [{ name: 'OXESpace conversation', extensions: ['json'] }] }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length !== 1) return null
    const input = await readFile(result.filePaths[0], 'utf8')
    sender(event)
    return (await manager).importPortable(string(id), input)
  })
  ipcMain.handle(IPC_CHANNELS.thread.projectDiff, (event, id: unknown) => { sender(event); return manager.then(service => service.projectDiff(string(id))) })
  ipcMain.handle(IPC_CHANNELS.thread.models, (event, id: unknown, refresh: unknown) => { sender(event); return manager.then(service => service.models(string(id), refresh === true)) })
  ipcMain.handle(IPC_CHANNELS.thread.command, (event, id: unknown, text: unknown) => { sender(event); return manager.then(service => service.command(string(id), string(text))) })
  ipcMain.handle(IPC_CHANNELS.thread.observe, (event, id) => { sender(event); return manager.then(service => service.observe(string(id))) })
  ipcMain.handle(IPC_CHANNELS.thread.recover, (event, id: unknown) => { sender(event); return manager.then(service => service.recover(string(id))) })
  ipcMain.handle(IPC_CHANNELS.thread.configure, (event, id: unknown, input: unknown, revision: unknown) => {
    sender(event)
    if (!input || typeof input !== 'object' || !Number.isSafeInteger(revision) || Number(revision) < 0) throw Error('Invalid configuration')
    const value = input as Record<string, unknown>
    if (Object.keys(value).some(key => !['model', 'reasoningEffort', 'access', 'networkAccess', 'approvalPolicy', 'mode', 'hooksEnabled'].includes(key))) throw Error('Unknown configuration field')
    if (value.model !== undefined && (typeof value.model !== 'string' || !/^[a-z0-9][a-z0-9._:/\[\]-]{0,199}$/i.test(value.model))) throw Error('Invalid model')
    if (value.reasoningEffort !== undefined && (typeof value.reasoningEffort !== 'string' || !/^[a-z0-9_-]{1,30}$/i.test(value.reasoningEffort))) throw Error('Invalid effort')
    if (value.access !== undefined && !['read-only', 'workspace-write', 'full-access'].includes(String(value.access))) throw Error('Invalid access mode')
    if (value.networkAccess !== undefined && typeof value.networkAccess !== 'boolean') throw Error('Invalid network access')
    if (value.approvalPolicy !== undefined && !['untrusted', 'on-request', 'never'].includes(String(value.approvalPolicy))) throw Error('Invalid approval policy')
    if (value.mode !== undefined && !['default', 'plan'].includes(String(value.mode))) throw Error('Invalid collaboration mode')
    if (value.hooksEnabled !== undefined && typeof value.hooksEnabled !== 'boolean') throw Error('Invalid hooks setting')
    return manager.then(service => service.configure(string(id), value, Number(revision)))
  })
  ipcMain.handle(IPC_CHANNELS.thread.commands, (event, id: unknown, forceRefresh: unknown) => {
    sender(event)
    if (forceRefresh !== undefined && typeof forceRefresh !== 'boolean') throw Error('Invalid command refresh input')
    return manager.then(service => service.commands(string(id), forceRefresh === true))
  })
  const dimension = (value: unknown): number => {
    if (!Number.isInteger(value) || Number(value) < 2 || Number(value) > 500) throw Error('Invalid terminal dimensions')
    return value as number
  }
  ipcMain.handle(IPC_CHANNELS.threadCli.open, event => {
    sender(event); throw Error('Interactive CLI tools have been replaced by integrated Thread controls. Use the conversation command menu.')
  })
  ipcMain.handle(IPC_CHANNELS.threadCli.state, (event, id: unknown) => {
    sender(event); return manager.then(service => service.cli(string(id))?.state() ?? { running: false, nativeSessionId: service.read(string(id)).thread.nativeSessionId })
  })
  ipcMain.handle(IPC_CHANNELS.threadCli.write, (event, id: unknown, data: unknown) => {
    sender(event); const input = string(data); return manager.then(service => service.cli(string(id))?.write(input))
  })
  ipcMain.handle(IPC_CHANNELS.threadCli.resize, (event, id: unknown, cols: unknown, rows: unknown) => {
    sender(event); const width = dimension(cols), height = dimension(rows); return manager.then(service => service.cli(string(id))?.resize(width, height))
  })
  ipcMain.handle(IPC_CHANNELS.threadCli.attach, (event, id: unknown) => {
    sender(event); return manager.then(service => service.cli(string(id))?.attach() ?? { running: false, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false })
  })
  ipcMain.handle(IPC_CHANNELS.threadCli.detach, (event, id: unknown) => { sender(event); return manager.then(service => service.cli(string(id))?.detach()) })
  ipcMain.handle(IPC_CHANNELS.threadCli.stop, (event, id: unknown) => { sender(event); return manager.then(service => service.stopCli(string(id))) })
  ipcMain.handle(IPC_CHANNELS.threadCli.insert, (event, id: unknown) => { sender(event); return manager.then(service => service.cli(string(id))?.insertCommand()) })
  ipcMain.handle(IPC_CHANNELS.threadCli.link, (event, id: unknown, nativeId: unknown) => { sender(event); return manager.then(service => service.linkCliSession(string(id), string(nativeId))) })
  ipcMain.handle(IPC_CHANNELS.thread.create, async (event, input: unknown) => {
    sender(event)
    if (!input || typeof input !== 'object') throw new Error('Invalid thread input')
    const value = input as Record<string, unknown>
    if (value.provider !== 'codex' && value.provider !== 'claude') throw new Error('Invalid thread provider')
    const context = threadProjects.context(string(value.projectId), value.rootPath === undefined ? undefined : string(value.rootPath))
    sender(event)
    const service = await manager
    return service.create({ workspaceId: `thread:${context.projectId}`, projectId: context.projectId, rootPath: context.rootPath, provider: value.provider })
  })
  ipcMain.handle(IPC_CHANNELS.thread.send, (event, id: unknown, text: unknown, attachmentIds: unknown) => { sender(event); return manager.then(service => service.send(string(id), string(text), stringList(attachmentIds, 8))) })
  ipcMain.handle(IPC_CHANNELS.thread.steer, (event, id: unknown, text: unknown, attachmentIds: unknown) => { sender(event); return manager.then(service => service.steer(string(id), string(text), stringList(attachmentIds, 8))) })
  ipcMain.handle(IPC_CHANNELS.thread.updateQueued, (event, id: unknown, itemId: unknown, text: unknown) => { sender(event); return manager.then(service => service.updateQueued(string(id), string(itemId), string(text))) })
  ipcMain.handle(IPC_CHANNELS.thread.deleteQueued, (event, id: unknown, itemId: unknown, preserveAttachments: unknown) => { sender(event); return manager.then(service => service.deleteQueued(string(id), string(itemId), preserveAttachments === true)) })
  ipcMain.handle(IPC_CHANNELS.thread.reorderQueued, (event, id: unknown, itemIds: unknown) => { sender(event); return manager.then(service => service.reorderQueued(string(id), stringList(itemIds, 100))) })
  ipcMain.handle(IPC_CHANNELS.thread.interrupt, (event, id: unknown) => { sender(event); return manager.then(service => service.interrupt(string(id))) })
  ipcMain.handle(IPC_CHANNELS.thread.approve, (event, id: unknown, request: unknown, decision: unknown) => {
    sender(event)
    if (decision !== 'accept' && decision !== 'decline') throw new Error('Invalid approval decision')
    return manager.then(service => service.approve(string(id), string(request), decision))
  })
  ipcMain.handle(IPC_CHANNELS.thread.respond, (event, id: unknown, request: unknown, response: unknown) => {
    sender(event)
    return manager.then(service => service.respond(string(id), string(request), requestResponse(response)))
  })
  ipcMain.handle(IPC_CHANNELS.thread.pin, (event, id: unknown, pinned: unknown) => {
    sender(event)
    if (typeof pinned !== 'boolean') throw new Error('Invalid pin input')
    return manager.then(service => service.pin(string(id), pinned))
  })
  return { manager, stop: async () => { await (await accounts).stop(); await (await manager).stop() } }
}
