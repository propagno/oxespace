// OXE-372: the Delegated work dialog names each knowledge source from the code:delegated.* catalog, in the interface
// language, never by its raw kind ("handoff", "checkpoint"…).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DelegatedWorkDialog } from '../../../src/components/Delegation/DelegatedWorkDialog'
import { changeLanguage } from '../../../src/i18n'
import type { KnowledgeTransferSource } from '../../../shared/types/delegation'

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

const KINDS: KnowledgeTransferSource['kind'][] = ['handoff', 'acceptance', 'evidence', 'memory', 'code', 'checkpoint', 'session']
const source = (kind: KnowledgeTransferSource['kind']): KnowledgeTransferSource => ({ kind, label: `label-${kind}`, sha256: 'a'.repeat(64), bytes: 10 })

async function renderWithSources(): Promise<void> {
  const task = { id: 'd-1', workspaceId: 'ws-1', objective: 'Build the API', branch: 'oxe/d-1', state: 'accepted', agentProfileId: 'claude', surface: 'terminal',
    updatedAt: Date.UTC(2026, 9, 14), path: '/wt', baseSha: 'abc', cwd: '/repo', dependencies: [],
    knowledgeBundle: { version: 1, revision: 2, objective: 'Build the API', acceptance: '', handoff: '', context: '', sources: KINDS.map(source), createdAt: 1, sha256: 'b'.repeat(64) } }
  Object.assign(window, { oxe: { delegation: {
    status: vi.fn(async () => ({ enabled: true, tasks: [task] })), onChanged: vi.fn(() => () => undefined),
    control: vi.fn(async () => undefined), adopt: vi.fn(async () => undefined)
  } } })
  render(<DelegatedWorkDialog workspaces={[{ id: 'ws-1', name: 'repo' } as never]} workspaceId="ws-1" onClose={() => undefined} onOpen={async () => true} />)
  await screen.findByText('label-handoff')
}

/** What the dialog shows as the name of each source, in KINDS order. */
const sourceNames = (): string[] => KINDS.map(kind => screen.getByText(`label-${kind}`).closest('li')!.querySelector('strong')!.textContent ?? '')

describe('OXE-372 · Delegated work names its knowledge sources', () => {
  test('in pt-BR every source kind has its catalog name, none is shown raw', async () => {
    await changeLanguage('pt-BR')
    await renderWithSources()
    const names = sourceNames()
    for (const [index, kind] of KINDS.entries()) {
      expect(names[index], `${kind} has a name`).toBeTruthy()
      expect(names[index], `${kind} is not shown raw`).not.toBe(kind)
    }
    expect(names).toEqual(['Passagem de trabalho', 'Critérios de aceite', 'Evidência', 'AI Memory', 'Código', 'Checkpoint', 'Conversa'])
  })

  test('in English the same names come from the catalog', async () => {
    await renderWithSources()
    expect(sourceNames()).toEqual(['Handoff', 'Acceptance criteria', 'Evidence', 'AI Memory', 'Code', 'Checkpoint', 'Conversation'])
  })
})
