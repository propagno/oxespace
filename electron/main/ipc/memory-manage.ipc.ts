import type { MemoryControl } from '../services/memory/memory-control'

export type MemoryManageAction = 'notes' | 'noteDelete' | 'export' | 'reset'

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('Invalid memory input')
  return value
}

/** Validates what Settings sends for looking through, exporting, deleting and resetting stored memory, then does it. Loaded on first use. */
export async function handleMemoryManage(action: MemoryManageAction, control: () => Promise<MemoryControl>, input: Record<string, unknown> | undefined): Promise<unknown> {
  const workspaceId = text(input?.workspaceId)
  switch (action) {
    case 'notes': return (await control()).notes({ workspaceId, ...(input?.query ? { query: text(input.query) } : {}) })
    case 'noteDelete': return (await control()).noteDelete({ workspaceId, path: text(input?.path) })
    case 'export': return (await control()).export({ workspaceId, scope: input?.scope === 'team' ? 'team' : 'all' })
    case 'reset':
      if (input?.scope !== 'project' && input?.scope !== 'all') throw new Error('Invalid reset scope')
      return (await control()).reset({ workspaceId, scope: input.scope, confirm: typeof input.confirm === 'string' ? input.confirm : '' })
  }
}
