/**
 * Thread slash-command routing: aliases, validation, integrated panels and the
 * provider operations behind /resume, /fork, /rewind, /checkpoint and friends.
 *
 * Moved out of ThreadOrchestrator unchanged. It reaches the orchestrator only
 * through `CommandHost`, which names exactly what a command may touch.
 */
import type { AppDatabase } from '../../../db'
import type { AgentConversationAdapter, ConversationCapabilities, ConversationThread, ThreadCommandResult, ThreadConfiguration, ThreadRewindResult, ThreadSnapshot } from '../../../../../shared/types/thread'
import { hasDesktopCommand } from '../../../../../shared/threadDesktopCommands'
import { PARTIAL_NATIVE_HISTORY_NOTICE } from '../../../../../shared/threadHistoryNotice'
import type { ThreadCheckpointService } from '../thread-checkpoints'
import type { ThreadNativeCli } from '../thread-cli'
import type { ThreadExportService } from '../thread-export.service'
import type { ThreadHistory, ThreadHistoryWriteOptions } from '../thread-history'
import { threadCapabilityManifest } from '../thread-capabilities'
import { instructionLabel, instructionSources } from '../instruction-sources'

export interface CommandHost {
  readonly db: AppDatabase
  readonly history: ThreadHistory
  readonly exports: ThreadExportService
  readonly checkpoints: ThreadCheckpointService
  readonly nativeCli?: Pick<ThreadNativeCli, 'read'>
  read(id: string): ThreadSnapshot
  save(snapshot: ThreadSnapshot, options?: ThreadHistoryWriteOptions): void
  create(context: Pick<ConversationThread, 'workspaceId' | 'projectId' | 'rootPath' | 'provider' | 'agentProfileId'>): ThreadSnapshot
  configure(id: string, input: ThreadConfiguration, revision: number): Promise<unknown>
  interrupt(id: string): Promise<void>
  rewind(id: string, turnId: string): Promise<ThreadRewindResult>
  send(id: string, text: string): Promise<void>
  connectAdapter(id: string, thread: ConversationThread): Promise<AgentConversationAdapter>
  assertNativeSessionAvailable(id: string, provider: ConversationThread['provider'], nativeSessionId: string | null): void
  adapterCapabilities(id: string): ConversationCapabilities | undefined
  isBusy(id: string): boolean
  isConfiguring(id: string): boolean
  /** Holds the configuring lock for a provider operation. */
  withConfiguring<T>(id: string, run: () => Promise<T>): Promise<T>
  disposeAdapter(id: string): Promise<void>
  /** Removes the conversation, its cached snapshot and its attachments. */
  deleteThread(id: string): Promise<void>
}

export async function runThreadCommand(host: CommandHost, id: string, text: string): Promise<ThreadCommandResult> {
    const match = text.trim().match(/^\/([a-z0-9][a-z0-9_:-]*)(?:\s+([\s\S]*))?$/i)
    if (!match || text.length > 65536) throw Error('Invalid command')
    let name = match[1].toLowerCase()
    const argument = match[2]?.trim() ?? '', snapshot = host.read(id), thread = snapshot.thread
    const aliases: Record<string, string> = { delegation: 'delegations', approvals: 'permissions', 'allowed-tools': 'permissions', name: 'rename', clear: 'new', reset: 'new', cwd: 'pwd', plugin: 'plugins', config: 'settings', login: 'accounts', exit: 'quit' }
    name = aliases[name] ?? name
    if (!hasDesktopCommand(thread.provider, name)) throw Error(`/${name} is not available in Thread yet. Use /help to see supported commands.`)
    if (argument && ['help', 'skills', 'accounts', 'settings', 'pwd', 'status', 'capabilities', 'instructions', 'copy', 'export', 'stop', 'new', 'quit', 'diff', 'usage', 'fork', 'hooks', 'experimental', 'debug-config', 'ps', 'memories'].includes(name)) throw Error(`/${name} does not accept arguments in Thread.`)
    if (name === 'delegations' && argument && !/^[a-z0-9-]{8,128}$/i.test(argument)) throw Error('Use /delegation <taskId> with an exact delegation ID.')
    if (name === 'resume' && argument) {
      const local = host.db.prepare('SELECT id FROM conversation_threads WHERE id = ?').get(argument) as { id: string } | undefined
      if (local) {
        const target = host.read(local.id)
        if (target.thread.provider !== thread.provider || target.thread.rootPath !== thread.rootPath) throw Error('Choose a conversation from this provider and project')
        if (target.thread.archived) { target.thread.archived = false; host.save(target, { eventsFrom: target.events.length }) }
        return { kind: 'navigate', threadId: target.thread.id }
      }
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(argument)) throw Error('Use a saved OXESpace conversation ID or an exact native session UUID.')
      for (const row of host.db.prepare('SELECT data_json FROM conversation_threads').all() as { data_json: string }[]) {
        const existing = JSON.parse(row.data_json) as ConversationThread
        if (existing.nativeSessionId !== argument) continue
        if (existing.provider !== thread.provider || existing.rootPath !== thread.rootPath) throw Error('Native session is linked to a different provider or project')
        if (existing.archived) { const restored = host.read(existing.id); restored.thread.archived = false; host.save(restored, { eventsFrom: restored.events.length }) }
        return { kind: 'navigate', threadId: existing.id }
      }
      if (!host.nativeCli) throw Error('Native session import is unavailable')
      host.assertNativeSessionAvailable(id, thread.provider, argument)
      const history = await host.nativeCli.read(thread, argument)
      const imported = host.create({ workspaceId: thread.workspaceId, projectId: thread.projectId, rootPath: thread.rootPath, provider: thread.provider, agentProfileId: thread.agentProfileId })
      imported.thread.nativeSessionId = argument
      imported.thread.title = history.title || `Recovered ${thread.provider} session`
      imported.events = history.events
      imported.thread.nativeHistoryCursor = history.cursor
      imported.thread.cliNotice = history.truncated ? PARTIAL_NATIVE_HISTORY_NOTICE : undefined
      host.save(imported, { eventsFrom: 0 })
      return { kind: 'navigate', threadId: imported.thread.id }
    }
    const surfaces: Record<string, NonNullable<ThreadCommandResult['surface']>> = { help: 'commands', skills: 'commands', accounts: 'accounts', logout: 'accounts', settings: 'settings', resume: 'sessions', delegations: 'delegations' }
    if (surfaces[name]) return { kind: 'panel', surface: surfaces[name], title: name, ...(name === 'delegations' && argument ? { text: argument } : {}) }
    if (['model', 'effort', 'permissions'].includes(name)) {
      if (!argument) return { kind: 'panel', surface: name as 'model' | 'effort' | 'permissions' }
      const [model, effort, extra] = argument.split(/\s+/)
      if (extra || name !== 'model' && effort) throw Error('Too many command arguments')
      if (name === 'permissions' && !['read-only', 'workspace-write', 'full-access'].includes(model)) throw Error('Choose read-only, workspace-write or full-access')
      await host.configure(id, name === 'model' ? { model, ...(effort ? { reasoningEffort: effort } : {}) } : name === 'effort' ? { reasoningEffort: model } : { access: model as ThreadConfiguration['access'] }, thread.configurationRevision ?? 0)
      return { kind: 'applied' }
    }
    if (name === 'plan') {
      if (argument && !['on', 'off'].includes(argument)) throw Error('Use /plan on or /plan off')
      await host.configure(id, { mode: argument === 'off' ? 'default' : 'plan' }, thread.configurationRevision ?? 0); return { kind: 'applied' }
    }
    if (name === 'pwd') return { kind: 'panel', title: 'Project directory', text: thread.rootPath }
    if (name === 'status') {
      const operation = host.history.operations(id).at(-1)
      return { kind: 'panel', title: 'Conversation status', rows: [
      { label: 'Thread ID', detail: thread.id }, { label: 'Project ID', detail: thread.projectId }, { label: 'Workspace ID', detail: thread.workspaceId },
      { label: 'Provider', detail: thread.provider }, { label: 'Status', detail: thread.status }, { label: 'Model', detail: thread.model || 'Provider default' }, { label: 'Effort', detail: thread.reasoningEffort || 'Automatic' },
      { label: 'Access', detail: thread.access ?? 'read-only' }, { label: 'Network', detail: thread.networkAccess ? 'allowed' : 'blocked' }, { label: 'Approvals', detail: thread.approvalPolicy ?? 'on-request' }, { label: 'Mode', detail: thread.mode ?? 'default' }, { label: 'Hooks', detail: thread.hooksEnabled ? 'native hooks enabled' : 'disabled' },
      { label: 'Connection', detail: thread.connection?.state ?? 'closed' }, { label: 'Generation', detail: String(thread.generation ?? 1) },
      { label: 'Operation', detail: operation ? `${operation.id} · ${operation.state}` : 'None' },
      { label: 'Directory', detail: thread.rootPath }, { label: 'Native session ID (resume)', detail: thread.nativeSessionId ?? 'Not started' }
    ] }
    }
    if (name === 'instructions') {
      // The provider loads these itself; this only shows what it will read and from where.
      const sources = instructionSources(thread.provider, thread.rootPath)
      const scopeLabel = { user: 'user', project: 'project', directory: 'subdirectory', local: 'local (not committed)', rules: 'rule' } as const
      return { kind: 'panel', title: 'Instruction files', text: sources.length
        ? `${thread.provider === 'claude' ? 'Claude Code' : 'Codex'} reads these files when the session starts, in this order. Edit them in the project to change how the agent behaves.`
        : `No ${thread.provider === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'} instruction files were found for this project.`,
      rows: sources.map(source => ({ label: instructionLabel(source, thread.rootPath), detail: `${scopeLabel[source.scope]} · ${source.bytes.toLocaleString()} bytes` })) }
    }
    if (name === 'capabilities') {
      const manifest = thread.capabilities ?? threadCapabilityManifest(thread.provider, host.adapterCapabilities(id))
      return { kind: 'panel', title: 'Thread capabilities', rows: Object.entries(manifest.features).map(([label, value]) => ({ label, detail: value.implemented ? `${value.verified} · ${value.enabled ? 'enabled' : 'disabled'}` : value.reason ?? 'Unavailable' })) }
    }
    if (name === 'copy' || name === 'export') return { kind: 'panel', title: name === 'copy' ? 'Copy response' : 'Export conversation', text: name === 'copy'
      ? snapshot.events.filter(event => event.type === 'message' && event.role === 'assistant').map(event => event.type === 'message' ? event.text : '').at(-1) ?? ''
      : host.exports.markdown(host.history.readImported(id)) }
    if (name === 'stop') { if (host.isBusy(id)) await host.interrupt(id); return { kind: 'applied' } }
    if ((name === 'archive' || name === 'delete') && argument === 'confirm' && host.isBusy(id)) {
      await host.interrupt(id)
      for (let attempt = 0; attempt < 50 && host.isBusy(id); attempt++) await new Promise(resolve => setTimeout(resolve, 100))
      if (host.isBusy(id)) throw Error('The active turn has not stopped. Try again after it finishes.')
    }
    if (host.isBusy(id) || host.isConfiguring(id)) throw Error('Finish the active operation before running this command')
    if (name === 'rename') {
      if (!argument) return { kind: 'panel', surface: 'rename', title: 'Rename conversation' }
      if (thread.provider === 'codex' && thread.nativeSessionId) await (await host.connectAdapter(id, thread)).command?.('rename', argument.slice(0, 120))
      const latest = host.read(id); latest.thread.title = argument.slice(0, 120); host.save(latest, { eventsFrom: latest.events.length }); return { kind: 'applied' }
    }
    if (name === 'new') {
      const created = host.create({ workspaceId: thread.workspaceId, projectId: thread.projectId, rootPath: thread.rootPath, provider: thread.provider })
      Object.assign(created.thread, { model: thread.model, reasoningEffort: thread.reasoningEffort, access: thread.access, networkAccess: thread.networkAccess, approvalPolicy: thread.approvalPolicy, mode: thread.mode, hooksEnabled: thread.hooksEnabled })
      host.save(created, { eventsFrom: created.events.length }); return { kind: 'navigate', threadId: created.thread.id }
    }
    if (name === 'archive' || name === 'delete') {
      if (argument !== 'confirm') return { kind: 'panel', title: name === 'delete' ? 'Delete conversation' : 'Archive conversation', text: name === 'delete' ? 'Delete this OXESpace conversation? The provider session is retained.' : 'Archive this conversation? You can reopen it from /resume.', rows: [{ id: `/${name} confirm`, label: name === 'delete' ? 'Delete conversation' : 'Archive conversation' }] }
      await host.disposeAdapter(id)
      if (name === 'delete') await host.deleteThread(id)
      else { const latest = host.read(id); latest.thread.archived = true; host.save(latest, { eventsFrom: latest.events.length }) }
      return { kind: 'navigate' }
    }
    if (name === 'quit') { await host.disposeAdapter(id); return { kind: 'applied' } }
    // The changes panel shows branch and uncommitted diffs with line comments for the agent.
    if (name === 'diff') return { kind: 'panel', surface: 'changes', title: 'Project changes' }
    if (name === 'checkpoint') {
      const [action = 'list', checkpointId, extra] = argument.split(/\s+/).filter(Boolean)
      if (extra || !['list', 'restore', 'delete'].includes(action) || action !== 'list' && !checkpointId) throw Error('Use /checkpoint, /checkpoint restore <id>, or /checkpoint delete <id>')
      if (action === 'restore') {
        const restored = await host.checkpoints.restore(id, checkpointId)
        return { kind: 'panel', title: 'Checkpoint restored', text: `${restored.fileCount} file${restored.fileCount === 1 ? '' : 's'} restored. Conversation history was not rewound.` }
      }
      if (action === 'delete') { host.checkpoints.delete(id, checkpointId); return { kind: 'applied', title: 'Checkpoint deleted' } }
      const rows = host.checkpoints.list(id).map(value => ({ id: value.state === 'ready' || value.state === 'conflict' ? `/checkpoint restore ${value.id}` : undefined, label: value.label, ...(value.turnId ? { turnId: value.turnId } : {}), detail: `${value.state} · ${value.fileCount} file${value.fileCount === 1 ? '' : 's'} · ${new Date(value.createdAt).toLocaleString()}${value.error ? ` · ${value.error}` : ''}` }))
      return { kind: 'panel', title: 'File checkpoints', text: 'Restore changes files only. Conversation history, Git index and unrelated dirty files are preserved.', rows }
    }
    if (['review', 'compact'].includes(name)) { await host.send(id, text); return { kind: 'applied' } }
    if (name === 'rewind' && argument && !/^[1-9][0-9]{0,2}$/.test(argument)) throw Error('Specify the number of turns to rewind (1–999)')
    if (name === 'rewind' && argument) {
      // Verified path: the provider is rewound and proven before local history changes.
      const turns = snapshot.turns ?? [], count = Number(argument)
      const target = turns[turns.length - count]
      if (!target) throw Error(`This conversation has only ${turns.length} turn${turns.length === 1 ? '' : 's'}.`)
      const result = await host.rewind(id, target.id)
      return { kind: 'applied', title: `Rewound ${result.removedTurns} turn${result.removedTurns === 1 ? '' : 's'}` }
    }
    if (name === 'rewind' && !argument) return { kind: 'panel', title: 'Rewind conversation', text: 'Remove the most recent turn from the native conversation. Files are not reverted.', rows: [{ id: '/rewind 1', label: 'Rewind one turn' }] }
    // Reserve ownership while starting/querying a provider operation.
    return host.withConfiguring(id, async () => {
      const adapter = await host.connectAdapter(id, thread)
      if (!adapter.command) throw Error('This provider does not expose the requested operation')
      const result = await adapter.command(name, argument)
      if (name === 'fork' && result.threadId) {
        const fork = host.create({ workspaceId: thread.workspaceId, projectId: thread.projectId, rootPath: thread.rootPath, provider: thread.provider })
        fork.thread = { ...fork.thread, nativeSessionId: result.threadId, model: thread.model, reasoningEffort: thread.reasoningEffort, access: thread.access, networkAccess: thread.networkAccess, approvalPolicy: thread.approvalPolicy, mode: thread.mode, hooksEnabled: thread.hooksEnabled, title: `${thread.title} · fork` }
        if (host.nativeCli) {
          const history = await host.nativeCli.read(fork.thread, result.threadId)
          fork.events = history.events
          fork.thread.nativeHistoryCursor = history.cursor
          fork.thread.cliNotice = history.truncated ? PARTIAL_NATIVE_HISTORY_NOTICE : undefined
        } else fork.events = host.history.readImported(id).events
        host.save(fork)
        return { kind: 'navigate', threadId: fork.thread.id }
      }
      if (name === 'rewind' && host.nativeCli) {
        const current = host.read(id)
        if (current.thread.nativeSessionId) {
          const history = await host.nativeCli.read(current.thread, current.thread.nativeSessionId)
          current.events = history.events
          current.thread.nativeHistoryCursor = history.cursor
          current.thread.cliNotice = history.truncated ? PARTIAL_NATIVE_HISTORY_NOTICE : undefined
          host.history.clearNativePages(id)
          host.save(current)
        }
      }
      return result
    })
  
}
