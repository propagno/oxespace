import { rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { looksLikeInstruction } from '../../../../shared/memory-fence'
import type { MemoryContext, MemoryExport, MemoryInput, MemoryNote, MemoryNotePatch,MemoryNotesView, MemoryReply, MemoryResetResult, MemoryResetScope, MemoryResult } from '../../../../shared/types/memory'
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

const SAFE_PATH = /^[\w./ -]{1,200}$/
/** The pages OXESpace writes itself (the only ones that can be replaced by an edit). */
const PAGE_PATH = /^decisions\/oxe-[0-9a-f-]{8,36}\.md$/

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

  /**
   * Pin, mark wrong, expire, review, move between scopes, or edit. An edit writes a new page that replaces the
   * old one (the old page is kept, hidden), and carries over what the person had set. The person who edits
   * has read the note, so the new one is trusted.
   */
  async noteUpdate(input: { workspaceId: string; path: string; patch: MemoryNotePatch }): Promise<MemoryNote> {
    const context = await this.deps.context(input.workspaceId)
    const { text, title, ...decisions } = input.patch
    const current = this.deps.ledger.get(context.projectId, input.path)
    if (!current || current.state === 'deleted') throw new Error('That note is not in this project’s memory')
    if (text === undefined && title === undefined) return this.deps.ledger.patch(context.projectId, input.path, decisions)
    if (!PAGE_PATH.test(input.path)) throw new Error('Only notes recorded through OXESpace can be edited. Delete this one and record a new note instead')
    const next = (text ?? current.text).trim()
    if (!next || next.length > 16000) throw new Error('A note must contain 1–16000 characters')
    const reply = await this.deps.manager.run(context, provider => provider.remember(context, { text: next, title: title ?? current.title, kind: current.kind,
      supersedes: input.path, origin: 'user' } as MemoryInput), 'write')
    if (reply.status !== 'ok') throw new Error(reply.message)
    const written = reply.value && 'path' in reply.value ? reply.value.path : undefined
    if (!written) throw new Error('The memory service did not say where the note was written')
    if (written === input.path) return this.deps.ledger.patch(context.projectId, written, { trust: 'trusted', ...decisions })
    // What the person had set moves to the new page; sharing with the team is kept only if it is still allowed.
    const carried = { pinned: current.pinned, expiresAt: current.expiresAt ?? null, trust: 'trusted' as const }
    this.deps.ledger.patch(context.projectId, written, carried)
    const scope = decisions.scope ?? current.scope
    try { this.deps.ledger.patch(context.projectId, written, { scope }) } catch (error) { if (decisions.scope) throw error }
    return this.deps.ledger.patch(context.projectId, written, { ...decisions, scope: undefined })
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
