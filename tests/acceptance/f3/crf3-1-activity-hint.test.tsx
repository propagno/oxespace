// Frozen acceptance test for CR-F3-1 (OXE program, phase F3, criterion A69): DESIGN's fix for the Agent activity page's
// hint (U3.1). The old line was 24 words and sent database and container requests to OxeQuery, which F3 makes wrong (they
// are listed on this page). Written by the planner; the executor must not edit it.
// It renders the real AgentActivitySettings (src/components/Settings/AgentActivitySettings.tsx) over a faked
// window.oxe.agentActivity and reads what a person sees; no catalog text is read from source.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length

async function renderPage(): Promise<void> {
  const agentActivity = { list: vi.fn(async () => ({ rows: [], cursor: null, failedSources: [] })), detail: vi.fn(async () => null), badge: vi.fn(async () => ({ today: 0, waiting: false })) }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, agentActivity } })
  const { AgentActivitySettings } = await import('../../../src/components/Settings/AgentActivitySettings')
  render(<AgentActivitySettings />)
}

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('CR-F3-1 · the Agent activity hint', () => {
  test.each([
    ['en', 'What agents changed through OXESpace, and what you decided.'],
    ['pt-BR', 'O que os agentes mudaram pelo OXESpace e o que você decidiu.']
  ])("the hint is DESIGN's line of 20 words or fewer (%s)", async (language, hint) => {
    await changeLanguage(language)
    await renderPage()
    const shown = await screen.findByText(hint)
    expect(words(shown.textContent ?? '')).toBeLessThanOrEqual(20)
  }, 30_000)
})
