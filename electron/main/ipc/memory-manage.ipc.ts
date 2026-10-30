import { MEMORY_SCOPES, type MemoryNotePatch, type MemoryScope } from '../../../shared/types/memory'
import type { MemoryControl } from '../services/memory/memory-control'

export type MemoryManageAction = 'notes' | 'noteUpdate' | 'noteDelete' | 'export' | 'reset'

/** Only the fields a person can change, each of the right type; anything else is dropped. */
export function notePatch(value: unknown): MemoryNotePatch {
  if (!value || typeof value !== 'object') throw new Error('Invalid memory note change')
  const input = value as Record<string, unknown>
  const patch: MemoryNotePatch = {}
  for (const key of ['pinned', 'wrong'] as const) if (input[key] !== undefined) { if (typeof input[key] !== 'boolean') throw new Error('Invalid memory note change'); patch[key] = input[key] as boolean }
  if (input.expiresAt !== undefined) { if (input.expiresAt !== null && (typeof input.expiresAt !== 'number' || !Number.isFinite(input.expiresAt))) throw new Error('Invalid memory note change'); patch.expiresAt = input.expiresAt as number | null }
  if (input.scope !== undefined) { if (!MEMORY_SCOPES.includes(input.scope as MemoryScope)) throw new Error('Invalid memory note change'); patch.scope = input.scope as MemoryScope }
  if (input.trust !== undefined) { if (input.trust !== 'trusted') throw new Error('Invalid memory note change'); patch.trust = 'trusted' }
  for (const key of ['text', 'title'] as const) if (input[key] !== undefined) { if (typeof input[key] !== 'string' || (input[key] as string).length > 16000) throw new Error('Invalid memory note change'); patch[key] = input[key] as string }
  return patch
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('Invalid memory input')
  return value
}

/** Validates what Settings sends for looking through, exporting, deleting and resetting stored memory, then does it. Loaded on first use. */
export async function handleMemoryManage(action: MemoryManageAction, control: () => Promise<MemoryControl>, input: Record<string, unknown> | undefined): Promise<unknown> {
  const workspaceId = text(input?.workspaceId)
  switch (action) {
    case 'notes': return (await control()).notes({ workspaceId, ...(input?.query ? { query: text(input.query) } : {}) })
    case 'noteUpdate': return (await control()).noteUpdate({ workspaceId, path: text(input?.path), patch: notePatch(input?.patch) })
    case 'noteDelete': return (await control()).noteDelete({ workspaceId, path: text(input?.path) })
    case 'export': return (await control()).export({ workspaceId, scope: input?.scope === 'team' ? 'team' : 'all' })
    case 'reset':
      if (input?.scope !== 'project' && input?.scope !== 'all') throw new Error('Invalid reset scope')
      return (await control()).reset({ workspaceId, scope: input.scope, confirm: typeof input.confirm === 'string' ? input.confirm : '' })
  }
}
