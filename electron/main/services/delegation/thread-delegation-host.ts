import { resolve } from 'node:path'
import type { DelegationTask } from '../../../../shared/types/delegation'
import type { ThreadManager } from '../conversation/thread-manager'
import type { ExecutionRegistry } from '../execution-registry'
import { delegationBootstrap } from '../agent-launch.service'

export interface DelegationHostResult {
  threadId: string
  executionId: string
  nativeSessionId: string
  provider: 'claude' | 'codex'
  generation: number
}

export class ThreadDelegationHost {
  constructor(
    private readonly manager: Promise<ThreadManager>,
    private readonly executions: ExecutionRegistry,
    private readonly provider: (agentProfileId: string) => 'claude' | 'codex',
    private readonly profile?: (agentProfileId: string) => { model?: string; systemPrompt?: string }
  ) {}

  async origin(threadId: string, workspaceId: string): Promise<{ cwd: string }> {
    const thread = (await this.manager).read(threadId).thread
    if (thread.workspaceId !== workspaceId) throw new Error('Origin conversation belongs to another workspace')
    return { cwd: thread.rootPath }
  }

  async inspect(task: DelegationTask): Promise<DelegationTask['nativeSession']> {
    if (!task.destinationThreadId) return undefined
    const manager = await this.manager
    const thread = manager.read(task.destinationThreadId).thread
    this.assertIdentity(task, thread.rootPath, thread.provider)
    if (!thread.nativeSessionId) return undefined
    if (task.nativeSession && task.nativeSession.nativeSessionId !== thread.nativeSessionId) throw new Error('NATIVE_SESSION_MISMATCH')
    return { provider: thread.provider, nativeSessionId: thread.nativeSessionId, canonicalRoot: task.path,
      generation: task.nativeSession?.generation ?? 1, observedAt: Date.now(), resumable: true }
  }

  async start(task: DelegationTask, persistThread?: (threadId: string) => void): Promise<DelegationHostResult> {
    const manager = await this.manager
    const provider = this.provider(task.agentProfileId)
    let threadId = task.destinationThreadId
    if (threadId) {
      const current = manager.read(threadId).thread
      this.assertIdentity(task, current.rootPath, current.provider)
    } else {
      const snapshot = manager.create({ workspaceId: task.workspaceId, projectId: task.project, rootPath: task.path, provider, agentProfileId: task.agentProfileId })
      threadId = snapshot.thread.id
      task.destinationThreadId = threadId
      persistThread?.(threadId)
      await manager.configure(threadId, {
        access: task.mode === 'analysis' ? 'read-only' : 'workspace-write',
        approvalPolicy: 'on-request', networkAccess: false, mode: 'default', hooksEnabled: false,
        ...(this.profile?.(task.agentProfileId).model ? { model: this.profile(task.agentProfileId).model } : {})
      }, snapshot.thread.configurationRevision ?? 0)
    }
    const current = manager.read(threadId).thread
    if (current.status === 'running' || current.status === 'approval' || current.cliActive) throw new Error('DELEGATION_SESSION_ALREADY_ACTIVE')
    if (!current.nativeSessionId && manager.read(threadId).events.some(event => event.type === 'message' && event.role === 'user')) {
      throw new Error('BOOTSTRAP_OUTCOME_UNKNOWN: inspect the preserved conversation before starting a new session')
    }
    if (!current.nativeSessionId) await manager.send(threadId, delegationBootstrap(task, this.profile?.(task.agentProfileId).systemPrompt))
    else await manager.send(threadId, `Resume OXESpace delegation ${task.id} from its persisted context and checkpoints. Do not repeat completed work. Check oxespace_delegation_inbox before continuing.`)
    const nativeSessionId = await this.awaitSession(manager, threadId)
    const execution = this.executions.forOwner({ kind: 'thread', id: threadId })
    if (!execution) throw new Error('Thread execution registration failed')
    return { threadId, executionId: execution.id, nativeSessionId,
      provider, generation: execution.generation }
  }

  async resume(task: DelegationTask): Promise<DelegationHostResult> {
    if (!task.destinationThreadId || !task.nativeSession?.nativeSessionId) throw new Error('No exact native session is bound to this delegation')
    const manager = await this.manager
    const thread = manager.read(task.destinationThreadId).thread
    this.assertIdentity(task, thread.rootPath, thread.provider)
    this.assertIdentity(task, task.nativeSession.canonicalRoot, task.nativeSession.provider)
    if (thread.nativeSessionId !== task.nativeSession.nativeSessionId) throw new Error('NATIVE_SESSION_MISMATCH')
    return this.start(task)
  }

  async stop(task: DelegationTask): Promise<void> {
    if (!task.destinationThreadId) return
    const manager = await this.manager
    const thread = manager.read(task.destinationThreadId).thread
    if (thread.status === 'running' || thread.status === 'approval') await manager.interrupt(task.destinationThreadId).catch(() => {})
    await manager.command(task.destinationThreadId, '/quit').catch(() => {})
  }

  private assertIdentity(task: DelegationTask, rootPath: string, provider: string): void {
    const canonical = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
    if (canonical(rootPath) !== canonical(task.path)) throw new Error('NATIVE_SESSION_ROOT_MISMATCH')
    if (provider !== this.provider(task.agentProfileId)) throw new Error('NATIVE_SESSION_PROVIDER_MISMATCH')
  }
  private async awaitSession(manager: ThreadManager, threadId: string): Promise<string> {
    const current = manager.read(threadId).thread
    if (current.nativeSessionId) return current.nativeSessionId
    return new Promise<string>((resolveSession, reject) => {
      let unsubscribe = () => {}
      const timer = setTimeout(() => { unsubscribe(); reject(new Error('Native session boundary was not confirmed. Inspect the preserved conversation.')) }, 30000)
      const inspect = () => {
        const thread = manager.read(threadId).thread
        if (thread.nativeSessionId) { clearTimeout(timer); unsubscribe(); resolveSession(thread.nativeSessionId) }
        else if (thread.status === 'failed' || thread.status === 'interrupted') { clearTimeout(timer); unsubscribe(); reject(new Error('Provider stopped before confirming its native session. Open the conversation for details.')) }
      }
      unsubscribe = manager.subscribe(threadId, inspect)
      inspect()
    })
  }
}
