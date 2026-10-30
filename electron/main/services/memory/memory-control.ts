import { rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { looksLikeInstruction } from '../../../../shared/memory-fence'
import type { MemoryContext, MemoryExport, MemoryNote, MemoryNotesView, MemoryReply, MemoryResetResult, MemoryResetScope, MemoryResult } from '../../../../shared/types/memory'
import type { MemoryLedger } from './memory-ledger'
import type { MemoryManager } from './memory-manager'

export interface ControlDependencies {
  ledger: MemoryLedger
  manager: MemoryManager
  /** The project's memory context for a workspace. */
  context(workspaceId: string): Promise<MemoryContext>
  /** The policy message when the project may not share memory with the team, or nothing. */
  teamBlock(projectId: string): string | undefined
  /** Runs the work while no agent or delivery can write memory; refuses to start while one could. */
  exclusive<T>(work: () => Promise<T>): Promise<T>
  runtime: { directory: string; settings(): { mode: 'managed' | 'connected' }; stop(): Promise<void>; start(): Promise<void> }
  anyEnabled(): boolean
  afterReset(): void
}

/** What the memory service lends to this module; the module itself loads on first use. */
export interface ControlHost {
  projects: { workspace(workspaceId: string): Promise<MemoryContext>; teamBlocked(projectId: string): string | undefined; anyEnabled(): boolean }
  manager: MemoryManager
  runtime: ControlDependencies['runtime']
  exclusive: ControlDependencies['exclusive']
  forgetStorage(): void
}

export function controlFor(host: ControlHost, ledger: MemoryLedger): MemoryControl {
  return new MemoryControl({ ledger, manager: host.manager, context: id => host.projects.workspace(id), teamBlock: id => host.projects.teamBlocked(id),
    exclusive: work => host.exclusive(work), runtime: host.runtime, anyEnabled: () => host.projects.anyEnabled(), afterReset: () => host.forgetStorage() })
}

const SAFE_PATH = /^[\w./ -]{1,200}$/

function externalNote(result: MemoryResult): MemoryNote {
  const stamp = Date.parse(result.updatedAt ?? '') || 0
  return { path: result.path ?? result.source, ...(result.title ? { title: result.title } : {}), text: result.text, scope: 'project', effectiveScope: 'project',
    trust: 'untrusted', suspicious: looksLikeInstruction(result.text), origin: { kind: 'unknown' }, pinned: false, wrong: false, state: 'active',
    createdAt: stamp, updatedAt: stamp, usedBy: [] }
}

/**
 * What a person can do with project memory from Settings: look, search, export, delete and start over (roadmap M4).
 * None of it is offered to agents: it has no tool, only the app’s own interface.
 */
export class MemoryControl {
  constructor(private readonly deps: ControlDependencies) {}

  async notes(input: { workspaceId: string; query?: string }): Promise<MemoryNotesView> {
    const context = await this.deps.context(input.workspaceId)
    const query = input.query?.trim().slice(0, 500)
    const known = this.deps.ledger.list(context.projectId, { query })
    // Pages the memory service captured itself are not in the ledger; they are shown, marked untrusted.
    const reply: MemoryReply<MemoryResult[]> = await this.deps.manager.run(context, provider => query ? provider.search(context, query) : provider.recent(context), 'read')
    const have = new Set(known.map(note => note.path))
    const captured = reply.status === 'ok' ? reply.value.filter(result => !have.has(result.path ?? result.source)).map(externalNote) : []
    const block = this.deps.teamBlock(context.projectId)
    return { notes: [...known, ...captured], teamAllowed: !block, ...(block ? { teamBlock: block } : {}) }
  }

  async noteDelete(input: { workspaceId: string; path: string }): Promise<{ erased: boolean }> {
    if (!SAFE_PATH.test(input.path) || input.path.includes('..')) throw new Error('Invalid memory page')
    const context = await this.deps.context(input.workspaceId)
    // Hidden first: from this moment no agent or tool is given the note, whatever happens next.
    this.deps.ledger.remove(context.projectId, input.path)
    const reply = await this.deps.manager.run(context, async provider => (await provider.erase?.(context, input.path)) ?? false, 'write')
    return { erased: reply.status === 'ok' && reply.value === true }
  }

  async export(input: { workspaceId: string; scope?: 'all' | 'team' }): Promise<MemoryExport> {
    const context = await this.deps.context(input.workspaceId)
    const scope = input.scope === 'team' ? 'team' : 'all'
    const block = this.deps.teamBlock(context.projectId)
    if (scope === 'team' && block) throw new Error(block)
    const { content, count } = this.deps.ledger.exportLines(context.projectId, scope)
    return { fileName: `oxespace-memory-${scope}-${new Date().toISOString().slice(0, 10)}.jsonl`, content, count }
  }

  async reset(input: { workspaceId: string; scope: MemoryResetScope; confirm: string }): Promise<MemoryResetResult> {
    if (input.confirm !== 'RESET') throw new Error('Type RESET to confirm')
    if (input.scope !== 'project' && input.scope !== 'all') throw new Error('Unknown reset scope')
    const context = await this.deps.context(input.workspaceId)
    if (input.scope === 'project') {
      return { scope: 'project', notesRemoved: this.deps.ledger.reset(context.projectId), storeErased: false }
    }
    if (this.deps.runtime.settings().mode !== 'managed') throw new Error('This memory service is not managed by OXESpace. Reset it where it runs; Reset this project still forgets the notes OXESpace knows')
    return this.deps.exclusive(async () => {
      const directory = resolve(this.deps.runtime.directory)
      await this.deps.runtime.stop()
      // Only the two folders that hold stored memory, and only directly inside the memory folder.
      for (const name of ['data', 'upgrade-2.6.2']) {
        const target = resolve(join(directory, name))
        if (dirname(target) !== directory || basename(target) !== name) throw new Error('Invalid memory folder')
        await rm(target, { recursive: true, force: true })
      }
      const removed = this.deps.ledger.resetAll()
      this.deps.afterReset()
      if (this.deps.anyEnabled()) await this.deps.runtime.start().catch(() => {})
      return { scope: 'all' as const, notesRemoved: removed, storeErased: true }
    })
  }
}
