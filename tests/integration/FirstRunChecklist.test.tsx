import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentReadiness } from '../../shared/types/agent'
import { FirstRunChecklist } from '../../src/components/Onboarding/FirstRunChecklist'
import { useAgentStore } from '../../src/store/agent.store'
import { useUIStore } from '../../src/store/ui.store'

const entry = (provider: AgentReadiness['provider'], status: AgentReadiness['status'], details?: string): AgentReadiness => ({ provider, command: provider, status, details })

function setup(options: { known?: AgentReadiness[]; discovered?: AgentReadiness[]; lastHealthCheckAt?: number | null } = {}) {
  const getReadiness = vi.fn(async () => options.known ?? [])
  const discover = vi.fn(async () => options.discovered ?? [])
  window.oxe = { ...window.oxe, agent: { getReadiness, discover } } as unknown as typeof window.oxe
  useAgentStore.setState({ readiness: [], isDiscovering: false, lastHealthCheckAt: options.lastHealthCheckAt ?? null })
  const openAgentSettings = vi.fn()
  useUIStore.setState({ openAgentSettings })
  render(<FirstRunChecklist />)
  return { getReadiness, discover, openAgentSettings }
}

describe('FirstRunChecklist', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  test('checks this machine once when it was never checked, and reports a ready CLI', async () => {
    const { discover } = setup({ discovered: [entry('claude', 'ready'), entry('codex', 'missing')] })
    expect(await screen.findByText('Claude Code is ready')).toBeInTheDocument()
    expect(screen.getByText('Code and Thread can use it.')).toBeInTheDocument()
    expect(discover).toHaveBeenCalledTimes(1)
    expect(discover).toHaveBeenCalledWith(false)
    // Nothing to fix, so no check button, but settings stay one click away.
    expect(screen.queryByRole('button', { name: /Check/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent settings' })).toBeInTheDocument()
  })

  test('does not probe the machine again when it was already checked', async () => {
    const { getReadiness, discover } = setup({ known: [entry('codex', 'ready')], lastHealthCheckAt: Date.now() })
    expect(await screen.findByText('Codex is ready')).toBeInTheDocument()
    expect(getReadiness).toHaveBeenCalled()
    expect(discover).not.toHaveBeenCalled()
  })

  test('says no CLI was found, links to the install guides and offers to check again', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const user = userEvent.setup()
    const { discover } = setup({ discovered: [entry('claude', 'missing'), entry('codex', 'missing')] })
    expect(await screen.findByText('No agent CLI found')).toBeInTheDocument()
    expect(screen.getByText(/make sure the command is on your PATH/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Install Claude Code' }))
    expect(open).toHaveBeenCalledWith(expect.stringContaining('anthropic.com'), '_blank', 'noopener,noreferrer')
    expect(screen.getByRole('button', { name: 'Install Codex CLI' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(discover).toHaveBeenLastCalledWith(true)
  })

  test('explains that Thread needs Claude Code or Codex when only another CLI is ready', async () => {
    setup({ discovered: [entry('copilot', 'ready'), entry('claude', 'missing')] })
    expect(await screen.findByText('Copilot CLI is ready')).toBeInTheDocument()
    expect(screen.getByText('Code can run it. Thread needs Claude Code or Codex.')).toBeInTheDocument()
  })

  test('stays on "not checked yet" with a Check now button when detection returns nothing', async () => {
    setup({ discovered: [] })
    expect(await screen.findByText('Agent CLIs not checked yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check now' })).toBeInTheDocument()
  })

  test('Agent settings opens the providers page', async () => {
    const user = userEvent.setup()
    const { openAgentSettings } = setup({ discovered: [entry('claude', 'ready')] })
    await screen.findByText('Claude Code is ready')
    await user.click(screen.getByRole('button', { name: 'Agent settings' }))
    expect(openAgentSettings).toHaveBeenCalledTimes(1)
  })

  test('is a labelled region and keeps its status text in a polite live region', async () => {
    setup({ discovered: [entry('claude', 'ready')] })
    const region = await screen.findByRole('region', { name: 'Before you start' })
    expect(region.querySelector('[aria-live="polite"]')).not.toBeNull()
  })

  test('tells the user the GitHub check waits for a project instead of faking a status', async () => {
    setup({ discovered: [entry('claude', 'ready')] })
    await waitFor(() => expect(screen.getByText(/OXESpace checks it once a project is open/)).toBeInTheDocument())
  })
})
