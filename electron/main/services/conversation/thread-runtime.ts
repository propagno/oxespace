import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { AppDatabase } from '../../db'
import { IPC_CHANNELS } from '../../../../shared/types/ipc'
import { ThreadManager } from './thread-manager'
import { AgentProcessTransport } from './process-transport'
import { CodexConversationAdapter } from './codex-conversation'
import { ClaudeConversationAdapter } from './claude-conversation'
import type { NativeAccountService } from './native-account.service'
import { AgentService } from '../agent.service'
import { ThreadCommandService } from './thread-commands'
import { ThreadNativeCli } from './thread-cli'
import { NativeHistoryWorkerClient } from './native-history-worker-client'
import { CodexStateReader } from './codex-state-reader'
import { ThreadModelService } from './thread-models'
import { bindThreadMcp, threadMcpArguments, type ThreadMcpBindings } from './thread-mcp'
import { ThreadAttachmentStore } from './thread-attachments'

export function createThreadManager(db: AppDatabase, accounts: NativeAccountService, mcp: ThreadMcpBindings): ThreadManager {
  const resolveProfile = (thread: import('../../../../shared/types/thread').ConversationThread) => {
    const profiles = new AgentService(db).list()
    const selected = thread.agentProfileId ? profiles.find(profile => profile.agentProfileId === thread.agentProfileId)
      : profiles.find(profile => profile.provider === thread.provider && !profile.parentProvider)
    if (!selected || (selected.parentProvider ?? selected.provider) !== thread.provider) throw new Error('Configure the selected agent profile in Agent Settings')
    return selected.parentProvider ? { ...selected, command: profiles.find(profile => profile.provider === selected.parentProvider && !profile.parentProvider)?.command ?? '' } : selected
  }
  const executable = (thread: import('../../../../shared/types/thread').ConversationThread) => {
    const profile = resolveProfile(thread)
    if (!profile) throw new Error('Configure the agent in Agent Settings')
    return profile.command
  }
  const broadcast = (channel: string, event: unknown) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, event) }
  const commands = new ThreadCommandService(executable)
  const cli = new ThreadNativeCli(executable, { historyReader: new NativeHistoryWorkerClient(join(app.getAppPath(), 'out', 'main', 'native-history-worker.js'), executable), data: event => broadcast(IPC_CHANNELS.threadCli.data, event), exit: event => broadcast(IPC_CHANNELS.threadCli.exit, event) })
  return new ThreadManager(db, async thread => {
    const profile = resolveProfile(thread)
    if (!profile) throw new Error('Configure the agent in Agent Settings')
    let executionId: string | undefined
    try {
      const env = await mcp.prepare(thread)
      executionId = env.OXESPACE_EXECUTION_ID
      const transport = (args: string[], cwd: string) => new AgentProcessTransport(profile.command, threadMcpArguments(thread.provider, args, mcp.bridge), cwd, env)
      const adapter = thread.provider === 'claude' ? new ClaudeConversationAdapter(transport)
        : new CodexConversationAdapter(transport(['app-server', '--listen', 'stdio://'], thread.rootPath))
      return bindThreadMcp(adapter, () => mcp.end(thread.id, executionId))
    } catch (error) { if (executionId) mcp.end(thread.id, executionId); throw error }
  }, threadId => {
    const row = db.prepare('SELECT data_json FROM conversation_threads WHERE id = ?').get(threadId) as { data_json: string } | undefined
    if (row) mcp.observed?.(JSON.parse(row.data_json))
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.thread.changed, { threadId })
  }, thread => accounts.requireSubscription({ provider: thread.provider, workspaceId: thread.workspaceId, threadId: thread.id }), commands, cli, new ThreadModelService(executable), new ThreadAttachmentStore(join(app.getPath('userData'), 'thread-attachments')), new CodexStateReader(executable))
}
