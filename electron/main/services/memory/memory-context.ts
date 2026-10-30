import { fenceContext, fenceMemory } from '../../../../shared/memory-fence'
import type { MemoryHandoff, MemoryResult, ProjectContext } from '../../../../shared/types/memory'

/** The part of a brief that memory may fill, in characters. A brief is bounded whatever the store holds. */
export const CONTEXT_BUDGET = 4000

/**
 * The brief an agent receives: every note and handoff as fenced data, with where it came from and how far to
 * trust it. Whole blocks only, so a brief is never cut in the middle of a fence.
 */
export function buildProjectContext(items: readonly MemoryResult[], handoffs: readonly MemoryHandoff[] = []): ProjectContext {
  const notes = items.map(item => ({ item, block: fenceMemory({ text: item.text, path: item.path ?? item.source, trust: item.trust ?? 'untrusted',
    origin: item.originKind, scope: item.scope, updatedAt: item.updatedAt }, 2400) }))
  const handoffBlocks = handoffs.map(handoff => ({ handoff, block: fenceMemory({ kind: 'handoff', trust: 'untrusted', origin: 'agent',
    path: `handoff:${handoff.id}`, text: `Historical handoff (${handoff.cwd ?? 'unknown checkout'}; state: ${handoff.state}; read-only): ${[handoff.summary, ...handoff.nextSteps, ...handoff.openQuestions].join('\n').slice(0, 650)}` }, 900) }))
  const text = fenceContext([...notes.map(note => note.block), ...handoffBlocks.map(entry => entry.block)], CONTEXT_BUDGET)
  // Sources list only what made it into the brief.
  return { text, sources: [...notes.filter(note => text.includes(note.block)).map(note => note.item.path ?? note.item.source),
    ...handoffBlocks.filter(entry => text.includes(entry.block)).map(entry => `handoff:${entry.handoff.id}`)] }
}
