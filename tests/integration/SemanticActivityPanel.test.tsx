import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SemanticActivityPanel } from '../../src/components/Semantic/SemanticActivityPanel'

const STATUS = {
  enabled: true,
  workerReady: true,
  indexing: false,
  count: 24,
  lastError: null,
  modelId: 'Xenova/multilingual-e5-base',
  mode: 'auto' as const,
  coverage: {
    lexicalDocuments: 24,
    lastIndexedAt: Date.now(),
    byCategory: { source: 15, test: 4, config: 3, docs: 2, other: 0 }
  },
  lastQuery: {
    requestedMode: 'auto' as const,
    resolvedMode: 'explore' as const,
    confidence: 'high' as const,
    expanded: false,
    expansionReason: null,
    durationMs: 42,
    semanticCandidates: 24,
    lexicalCandidates: 8,
    returnedResults: 5,
    estimatedTokens: 1350,
    estimatedFullFileTokens: 12_000,
    estimatedSavingsPercent: 89,
    truncated: false
  }
}

describe('SemanticActivityPanel quality controls', () => {
  beforeEach(() => {
    localStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
    window.oxe = {
      semantic: {
        getLogs: vi.fn().mockResolvedValue([]),
        onLog: vi.fn(() => vi.fn()),
        getStatus: vi.fn().mockResolvedValue(STATUS),
        setMode: vi.fn().mockImplementation(async ({ mode }) => ({ ...STATUS, mode })),
        reindex: vi.fn().mockResolvedValue(STATUS)
      }
    } as unknown as typeof window.oxe
  })

  test('shows coverage/quality and persists a retrieval mode change', async () => {
    const user = userEvent.setup()
    render(<SemanticActivityPanel workspaceId="ws-1" onClose={() => undefined} />)

    expect(await screen.findByText('24 searchable documents')).toBeInTheDocument()
    expect(screen.getByText('high confidence · explore')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Semantic retrieval mode'), 'exhaustive')
    await waitFor(() => expect(window.oxe.semantic.setMode).toHaveBeenCalledWith({ workspaceId: 'ws-1', mode: 'exhaustive' }))

    const persisted = JSON.parse(localStorage.getItem('oxe-terminal-prefs') ?? '{}')
    expect(persisted.state.overrides['ws-1'].semanticSearchMode).toBe('exhaustive')
  })
})
