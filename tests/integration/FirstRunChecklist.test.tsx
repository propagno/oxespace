import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentReadiness } from '../../shared/types/agent'
import { FirstRunChecklist } from '../../src/components/Onboarding/FirstRunChecklist'
import { useAgentStore } from '../../src/store/agent.store'
import { useNavigationPrefs } from '../../src/store/navigation-prefs.store'
import { stubOpenExternal } from '../helpers/openExternal'
import { useUIStore } from '../../src/store/ui.store'

const entry = (provider: AgentReadiness['provider'], status: AgentReadiness['status'], details?: string): AgentReadiness => ({ provider, command: provider, status, details })

function setup(options: { known?: AgentReadiness[]; discovered?: AgentReadiness[]; lastHealthCheckAt?: number | null } = {}) {
  const getReadiness = vi.fn(async () => options.known ?? [])
  const discover = vi.fn(async () => options.discovered ?? [])
  window.oxe = { ...window.oxe, agent: { getReadiness, discover } } as unknown as typeof window.oxe
  useAgentStore.setState({ readiness: [], isDiscovering: false, lastHealthCheckAt: options.lastHealthCheckAt ?? null })
  useNavigationPrefs.setState({ firstRun: { done: [], dismissed: false, startedAt: null, firstAnswerMs: null } })
  const openAgentSettings = vi.fn()
  useUIStore.setState({ openAgentSettings })
  const onNewWorkspace = vi.fn(), onAddProject = vi.fn()
  const view = render(<FirstRunChecklist onNewWorkspace={onNewWorkspace} onAddProject={onAddProject} />)
  return { getReadiness, discover, openAgentSettings, onNewWorkspace, onAddProject, view }
}

describe('FirstRunChecklist', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  test('checks this machine once when it was never checked, and reports a ready CLI', async () => {
    const { discover } = setup({ discovered: [entry('claude', 'ready'), entry('codex', 'missing')] })
    expect(await screen.findByText('Claude Code is ready')).toBeInTheDocument()
    expect(screen.getByText('OxeCode and OxeChat can use it.')).toBeInTheDocument()
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
    const open = stubOpenExternal()
    const user = userEvent.setup()
    const { discover } = setup({ discovered: [entry('claude', 'missing'), entry('codex', 'missing')] })
    expect(await screen.findByText('No agent CLI found')).toBeInTheDocument()
    expect(screen.getByText(/make sure the command is on your PATH/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Install Claude Code' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringContaining('anthropic.com')))
    expect(screen.getByRole('button', { name: 'Install Codex CLI' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(discover).toHaveBeenLastCalledWith(true)
  })

  test('explains that Thread needs Claude Code or Codex when only another CLI is ready', async () => {
    setup({ discovered: [entry('copilot', 'ready'), entry('claude', 'missing')] })
    expect(await screen.findByText('Copilot CLI is ready')).toBeInTheDocument()
    expect(screen.getByText('OxeCode can run it. OxeChat needs Claude Code or Codex.')).toBeInTheDocument()
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

  test('walks three steps, marks the CLI step done and starts the local clock', async () => {
    setup({ discovered: [entry('codex', 'ready')] })
    const steps = await screen.findAllByRole('listitem')
    expect(steps.map(step => step.querySelector('h3')?.textContent)).toEqual(['Agent CLIs (done)', 'Sign in', 'First folder and first answer', 'GitHub (optional)'])
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument()
    expect(useNavigationPrefs.getState().firstRun.done).toEqual(['agents'])
    expect(useNavigationPrefs.getState().firstRun.startedAt).toEqual(expect.any(Number))
  })

  test('opens a Thread project or a Code workspace from the third step', async () => {
    const user = userEvent.setup()
    const { onNewWorkspace, onAddProject } = setup({ discovered: [entry('claude', 'ready')] })
    await user.click(await screen.findByRole('button', { name: 'Add an OxeChat project' }))
    await user.click(screen.getByRole('button', { name: 'New OxeCode workspace' }))
    expect(onAddProject).toHaveBeenCalledTimes(1)
    expect(onNewWorkspace).toHaveBeenCalledTimes(1)
  })

  test('lets the account and GitHub steps be skipped, and stays hidden once dismissed', async () => {
    const user = userEvent.setup()
    const { view } = setup({ discovered: [entry('claude', 'ready')] })
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }))
    await user.click(screen.getByRole('button', { name: 'Mark as done' }))
    expect(useNavigationPrefs.getState().firstRun.done).toEqual(['agents', 'account', 'github'])
    expect(screen.getByText('2 of 3 done')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide this guide' }))
    expect(screen.queryByTestId('first-run-checklist')).not.toBeInTheDocument()
    view.rerender(<FirstRunChecklist />)
    expect(screen.queryByTestId('first-run-checklist')).not.toBeInTheDocument()
    expect(useNavigationPrefs.getState().firstRun.dismissed).toBe(true)
  })

  test('reports the first answer time once it is known', async () => {
    setup({ discovered: [entry('claude', 'ready')] })
    useNavigationPrefs.setState(state => ({ firstRun: { ...state.firstRun, done: ['agents', 'folder'], firstAnswerMs: 125_000 } }))
    expect(await screen.findByText(/First answer 2m 05s after you started/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New OxeCode workspace' })).not.toBeInTheDocument()
  })
})
