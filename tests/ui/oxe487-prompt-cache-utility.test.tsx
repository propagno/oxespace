import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadUsageRing } from '../../src/components/Threads/ThreadUsageRing'
import { SessionContextSection } from '../../src/components/Threads/ThreadSessionSections'
import { ConversationSettings } from '../../src/components/Settings/ConversationSettings'
import { ensureSideChat, resetSideChats } from '../../src/components/Threads/side/sideChatStore'
import { useThreadPrefs } from '../../src/store/thread-prefs.store'
import { changeLanguage } from '../../src/i18n'
import type { ThreadContextReport, ThreadPromptCacheState, ThreadSnapshot } from '../../shared/types/thread'

const baseContext: ThreadContextReport = {
  model: 'claude-sonnet-4-6',
  usedTokens: 45_000,
  windowTokens: 200_000,
  percentage: 23,
  categories: [],
  capturedAt: Date.now(),
  source: 'claude-control'
}

beforeEach(() => {
  localStorage.clear()
  useThreadPrefs.setState({ utilityModel: '' })
  resetSideChats()
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      agentCredits: { get: vi.fn(async () => ({ available: false })) },
      thread: { contextUsage: vi.fn(async () => null) }
    }
  })
})

afterEach(async () => {
  cleanup()
  resetSideChats()
  await changeLanguage('en')
})

describe('OXE-487 UI · Prompt Cache Stale/Break Hint', () => {
  it('shows subtle indicator, tooltip and popover hint when prompt cache is stale or broken', async () => {
    const staleCache: ThreadPromptCacheState = {
      fingerprint: 'p=claude|m=claude-sonnet-4-6',
      lastCachedAt: Date.now() - 7 * 60_000,
      ttlMs: 5 * 60_000,
      lastCacheReadTokens: 32_000,
      baselineCacheReadTokens: 32_000
    }

    const { rerender } = render(
      <ThreadUsageRing provider="claude" idle threadId="t1" context={baseContext} promptCache={staleCache} />
    )
    const trigger = screen.getByRole('button')
    expect(trigger).toHaveAttribute('data-cache-state', 'stale')
    expect(trigger.getAttribute('title')).toMatch(/Prompt cache expired after \d+m idle/i)
    expect(trigger.querySelector('.thread-usage-ring-cache-dot')).not.toBeNull()

    await userEvent.click(trigger)
    const hint = await screen.findByTestId('usage-prompt-cache-hint')
    expect(hint).toHaveAttribute('data-cache-state', 'stale')
    expect(hint.textContent).toMatch(/Prompt cache expired/i)

    // Broken cache (model changed)
    const brokenCache: ThreadPromptCacheState = {
      ...staleCache,
      lastCachedAt: Date.now() - 20_000,
      breakReason: 'model-changed',
      brokenAt: Date.now() - 5_000
    }
    rerender(<ThreadUsageRing provider="claude" idle threadId="t1" context={baseContext} promptCache={brokenCache} />)
    expect(trigger).toHaveAttribute('data-cache-state', 'broken')
    expect(screen.getByTestId('usage-prompt-cache-hint').textContent).toMatch(/model changed/i)

    // pt-BR translation
    await changeLanguage('pt-BR')
    await waitFor(() => {
      expect(screen.getByTestId('usage-prompt-cache-hint').textContent).toMatch(/Cache de prompt reiniciado \(modelo alterado\)/i)
    })
  })

  it('surfaces prompt cache status in SessionContextSection notes', () => {
    const snapshot: ThreadSnapshot = {
      thread: {
        id: 't2',
        workspaceId: 'ws',
        projectId: 'proj',
        rootPath: '/repo',
        provider: 'claude',
        nativeSessionId: 'nat-1',
        title: 'Test',
        pinned: false,
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
        contextReport: baseContext,
        promptCache: {
          fingerprint: 'fp',
          lastCachedAt: Date.now() - 30_000,
          ttlMs: 300_000,
          lastCacheReadTokens: 15_000,
          baselineCacheReadTokens: 15_000,
          breakReason: 'mcp-tools-changed',
          brokenAt: Date.now() - 10_000
        }
      },
      events: []
    }

    render(<SessionContextSection snapshot={snapshot} running={false} onOpenPanel={vi.fn()} />)
    const note = screen.getByTestId('session-prompt-cache-status')
    expect(note).toHaveAttribute('data-cache-state', 'broken')
    expect(note.textContent).toMatch(/tools changed/i)
  })
})

describe('OXE-487 UI · Utility Model Preference & Side Chat Forwarding', () => {
  it('persists utilityModel in thread-prefs store and keeps SendKeySetting last in ConversationSettings', () => {
    render(<ConversationSettings />)
    const utilityInput = screen.getByLabelText('Utility model') as HTMLInputElement
    const sendKeyGroup = screen.getByRole('radiogroup', { name: 'Send message with' })

    // Utility model section must precede SendKeySetting (OXE-131 contract)
    expect(utilityInput.compareDocumentPosition(sendKeyGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.change(utilityInput, { target: { value: 'claude-haiku-4-5' } })
    fireEvent.blur(utilityInput)
    expect(useThreadPrefs.getState().utilityModel).toBe('claude-haiku-4-5')

    // Clearing returns to Auto ('')
    fireEvent.change(utilityInput, { target: { value: '   ' } })
    fireEvent.blur(utilityInput)
    expect(useThreadPrefs.getState().utilityModel).toBe('')
  })

  it('forwards configured utilityModel to sideOpen while keeping default call signature unchanged when Auto/empty', async () => {
    const sideOpen = vi.fn(async () => ({
      ok: true as const,
      side: { sideId: 'side-1', threadId: 't-1', provider: 'claude' as const, readOnly: true as const }
    }))
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: { thread: { sideOpen, onSideEvent: vi.fn(() => () => {}) } }
    })

    // Default '' keeps exact single-arg call
    useThreadPrefs.setState({ utilityModel: '' })
    await ensureSideChat('t-1')
    expect(sideOpen).toHaveBeenLastCalledWith('t-1')

    // Configured utility model is forwarded
    resetSideChats()
    useThreadPrefs.setState({ utilityModel: 'claude-haiku-4-5' })
    await ensureSideChat('t-2')
    expect(sideOpen).toHaveBeenLastCalledWith('t-2', { utilityModel: 'claude-haiku-4-5' })
  })
})
