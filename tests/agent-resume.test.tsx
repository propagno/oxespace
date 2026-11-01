import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentHooksStatus } from '../shared/types/agent-hooks'
import type { AgentLifecycleState } from '../shared/types/agent-state'
import type { PaneAgentResume } from '../shared/types/ipc/terminal'
import { AgentHooksPromptHost } from '../src/components/AgentSessions/AgentHooksPromptHost'
import { AgentSessionDetails, EnableResumeMenuItem, PaneHooksNotice, PaneResumeMarker, StartFreshMenuItem, usePaneResume } from '../src/components/AgentSessions/PaneResume'
import { changeLanguage } from '../src/i18n'
import { useAgentResumeStore, type ResumeAgent } from '../src/store/agent-resume.store'
import { useToasts } from '../src/ui/Toast'

function install(outcomes: Record<string, PaneAgentResume>, hooks: Partial<Record<'claude-code' | 'codex', AgentHooksStatus['state']>> = {}) {
  const state = { 'claude-code': 'installed', codex: 'installed', ...hooks } as Record<'claude-code' | 'codex', AgentHooksStatus['state']>
  const api = {
    terminal: { status: vi.fn(async (paneId: string) => ({ running: true, seq: 0, altScreen: false, ...(outcomes[paneId] ? { agentResume: outcomes[paneId] } : {}) })) },
    agentHooks: {
      status: vi.fn(async (): Promise<AgentHooksStatus[]> => (['claude-code', 'codex'] as const).map(agent => ({ agent, state: state[agent], missing: [], detail: null }))),
      install: vi.fn(async (agent: 'claude-code' | 'codex'): Promise<AgentHooksStatus> => { state[agent] = 'installed'; return { agent, state: 'installed', missing: [], detail: null } })
    }
  }
  ;(window as unknown as { oxe: unknown }).oxe = api
  return api
}

function Pane({ id, agent, running = true, agentState = null }: { id: string; agent: ResumeAgent | null; running?: boolean; agentState?: AgentLifecycleState | null }) {
  const outcome = usePaneResume(id, `Pane ${id}`, running, agent, agentState)
  return <div data-testid={`pane-${id}`}>
    {outcome && <PaneResumeMarker paneId={id} outcome={outcome} />}
    <PaneHooksNotice paneId={id} />
    {agent && <EnableResumeMenuItem agent={agent} onDone={run => run()} />}
  </div>
}

const toastTitles = (): string[] => useToasts.getState().items.map(item => item.title)
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

beforeEach(() => { localStorage.clear(); useAgentResumeStore.getState().reset(); useToasts.setState({ items: [] }) })
afterEach(async () => { cleanup(); delete (window as unknown as { oxe?: unknown }).oxe; await changeLanguage('en') })

describe('what became of a pane\'s earlier session', () => {
  it('a resumed pane says so, read aloud without the session id, until the agent takes a turn', async () => {
    const api = install({ a: { outcome: 'resumed', agent: 'claude', sessionId: '0199a1b2-c3d4-7e5f' } })
    const { rerender } = render(<Pane id="a" agent="claude" />)
    const marker = await screen.findByTestId('pane-resume-marker')
    expect(marker).toHaveTextContent('Session resumed')
    expect(marker).toHaveAccessibleName('Resumed the earlier Claude session')
    expect(marker).toHaveAttribute('title', expect.stringContaining('0199a1b2-c3d4-7e5f'))
    // Its first turn: the sign has done its job.
    rerender(<Pane id="a" agent="claude" agentState="working" />)
    await waitFor(() => expect(screen.queryByTestId('pane-resume-marker')).toBeNull())
    expect(api.terminal.status).toHaveBeenCalledTimes(1)
  })

  it('a session that was not resumed says why in the interface language; several found together are one notice', async () => {
    await changeLanguage('pt-BR')
    const gone = (paneId: string): PaneAgentResume => ({ outcome: 'notResumed', agent: 'codex', sessionId: `${paneId}-99`, message: { code: 'agents.resume.sessionMissing', params: {} } })
    install({ b: gone('b'), c: gone('c') })
    render(<><Pane id="b" agent="codex" /><Pane id="c" agent="codex" /></>)
    const marker = await within(screen.getByTestId('pane-b')).findByTestId('pane-resume-marker')
    expect(marker).toHaveTextContent('Não retomada')
    expect(marker.getAttribute('aria-label')).toMatch(/^A sessão anterior do Codex não foi retomada: /)
    expect(marker.getAttribute('aria-label')).not.toContain('agents.resume')
    await waitFor(() => expect(toastTitles()).toEqual(['2 painéis não retomaram a sessão anterior']), { timeout: 4000 })
  })

  it('nothing is shown when nothing was recorded, before the pane runs, or on an older main', async () => {
    const api = install({ c: { outcome: 'nothingRecorded' } })
    render(<><Pane id="c" agent="claude" /><Pane id="d" agent="claude" running={false} /></>)
    await waitFor(() => expect(api.terminal.status).toHaveBeenCalledWith('c'))
    expect(screen.queryByTestId('pane-resume-marker')).toBeNull()
    expect(api.terminal.status).not.toHaveBeenCalledWith('d')
  })
})

describe('the status hooks question', () => {
  it('offered on its own, it is a notice in the pane that started the agent, never a dialog; "Install" installs', async () => {
    const api = install({}, { 'claude-code': 'not_installed' })
    const user = userEvent.setup()
    render(<><Pane id="a" agent="claude" /><Pane id="b" agent="claude" /><AgentHooksPromptHost /></>)
    const notice = await within(screen.getByTestId('pane-a')).findByTestId('pane-hooks-notice')
    expect(notice).toHaveTextContent('~/.claude')
    expect(within(screen.getByTestId('pane-b')).queryByTestId('pane-hooks-notice')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(within(screen.getByTestId('pane-a')).getByRole('button', { name: 'Install' }))
    expect(api.agentHooks.install).toHaveBeenCalledWith('claude-code')
    await waitFor(() => expect(toastTitles()).toContain('Claude Code panes now record their sessions'))
    expect(screen.queryByTestId('pane-hooks-notice')).toBeNull()
    expect(screen.queryByTestId('pane-enable-resume')).toBeNull()
  })

  it('"Not now" waits for the next run; "Don\'t ask again" never offers it, but the pane\'s menu opens it as a dialog', async () => {
    install({}, { codex: 'not_installed' })
    const user = userEvent.setup()
    const { unmount } = render(<><Pane id="a" agent="codex" /><AgentHooksPromptHost /></>)
    await user.click(await screen.findByRole('button', { name: 'Not now' }))
    unmount()
    render(<><Pane id="b" agent="codex" /><AgentHooksPromptHost /></>)
    await settle()
    expect(screen.queryByTestId('pane-hooks-notice')).toBeNull()
    cleanup()

    // Next run.
    useAgentResumeStore.getState().reset()
    render(<><Pane id="c" agent="codex" /><AgentHooksPromptHost /></>)
    await user.click(await screen.findByRole('button', { name: "Don't ask again" }))
    cleanup()
    useAgentResumeStore.getState().reset()
    render(<><Pane id="d" agent="codex" /><AgentHooksPromptHost /></>)
    await settle()
    expect(screen.queryByTestId('pane-hooks-notice')).toBeNull()
    // Asked for from the menu: the dialog.
    await user.click(await screen.findByTestId('pane-enable-resume'))
    expect(await screen.findByRole('dialog', { name: 'Let Codex panes come back after a crash?' })).toBeInTheDocument()
  })

  it('reads in pt-BR, and never asks when the hooks are installed or the pane runs another agent', async () => {
    await changeLanguage('pt-BR')
    install({}, { 'claude-code': 'not_installed' })
    render(<><Pane id="a" agent="claude" /><AgentHooksPromptHost /></>)
    const notice = await screen.findByTestId('pane-hooks-notice')
    expect(notice.closest('[data-intent]')).toHaveTextContent('Deixar os painéis do Claude Code voltarem após um travamento?')
    for (const name of ['Instalar', 'Agora não', 'Não perguntar de novo']) expect(screen.getByRole('button', { name })).toBeInTheDocument()
    cleanup(); useAgentResumeStore.getState().reset()
    install({}, {})
    render(<><Pane id="b" agent="claude" /><Pane id="c" agent={null} /><AgentHooksPromptHost /></>)
    await settle()
    expect(screen.queryByTestId('pane-hooks-notice')).toBeNull()
  })
})

describe('a session that would not load', () => {
  it('is a warning with its reason, unlike a fresh start the person chose', () => {
    const failed: PaneAgentResume = { outcome: 'notResumed', agent: 'claude', sessionId: '0199a1b2', message: { code: 'agents.resume.failedToLoad', params: {} } }
    render(<PaneResumeMarker paneId="x" outcome={failed} />)
    const marker = screen.getByTestId('pane-resume-marker')
    expect(marker).toHaveAttribute('data-outcome', 'notResumed')
    expect(marker).toHaveAccessibleName('The earlier Claude session was not resumed: The agent could not load its previous session and closed, so this pane started a new one.')
    cleanup()
    const { container } = render(<PaneResumeMarker paneId="x" outcome={{ ...failed, message: { code: 'agents.resume.startedFresh', params: {} } }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('starting a resumed pane fresh', () => {
  it('asks first, restarts without the session, and then shows neither a marker nor a warning; a failure is said in our words', async () => {
    const outcomes: Record<string, PaneAgentResume> = { a: { outcome: 'resumed', agent: 'claude', sessionId: '0199a1b2-c3d4' } }
    const api = install(outcomes)
    const restart = vi.fn(async () => { throw new Error('EPERM: raw internals') })
    ;(api.terminal as unknown as { restart: typeof restart }).restart = restart
    const user = userEvent.setup()
    function Resumed() {
      const outcome = usePaneResume('a', 'Pane a', true, 'claude')
      return <>{outcome && <PaneResumeMarker paneId="a" outcome={outcome} />}{outcome?.outcome === 'resumed' && <StartFreshMenuItem paneId="a" agent="claude" onDone={run => run()} />}</>
    }
    render(<><Resumed /><AgentHooksPromptHost /></>)
    await user.click(await screen.findByTestId('pane-start-fresh'))
    const dialog = await screen.findByRole('dialog', { name: 'Start this Claude pane fresh?' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus())
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await user.click(within(dialog).getByRole('button', { name: 'Start fresh' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not restart the pane.')
    expect(dialog).not.toHaveTextContent('EPERM')

    restart.mockImplementation(async () => { outcomes.a = { outcome: 'notResumed', agent: 'claude', sessionId: '0199a1b2-c3d4', message: { code: 'agents.resume.startedFresh', params: {} } } })
    await user.click(within(dialog).getByRole('button', { name: 'Start fresh' }))
    expect(restart).toHaveBeenLastCalledWith({ paneId: 'a', resume: false })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.queryByTestId('pane-resume-marker')).toBeNull())
    expect(toastTitles()).toEqual([])
  })
})

describe('the pane details name its agent session', () => {
  it('shows the native id, where it came from and what became of the earlier one; copies main’s resume command', async () => {
    const writeText = vi.fn(async () => true)
    ;(window as unknown as { oxe: unknown }).oxe = { clipboard: { writeText } }
    const user = userEvent.setup()
    const session = { agent: 'claude' as const, sessionId: '0199a1b2-c3d4', source: 'launch' as const, resumeCommand: 'claude --resume 0199a1b2-c3d4' }
    // A long id is cut in the middle; the whole id is in the title.
    const long = '0199a1b2-c3d4-7e5f-9a0b-1c2d3e4f5a6b'
    const { unmount } = render(<AgentSessionDetails session={{ ...session, sessionId: long, resumeCommand: `claude --resume ${long}` }} />)
    expect(screen.getByTestId('pane-agent-session-id')).toHaveTextContent('0199a1b2…3e4f5a6b')
    expect(screen.getByTestId('pane-agent-session-id')).toHaveAttribute('title', long)
    unmount()
    const { rerender } = render(<AgentSessionDetails session={session} resume={{ outcome: 'resumed', agent: 'claude', sessionId: '0199a1b2-c3d4' }} />)
    const row = screen.getByTestId('pane-agent-session')
    expect(row.textContent).toMatch(/Agent session.{0,120}0199a1b2-c3d4/)
    expect(row).toHaveTextContent('Set when OXESpace started the agent')
    expect(row).toHaveTextContent('Resumed when the pane started')
    await user.click(screen.getByRole('button', { name: 'Copy resume command' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('claude --resume 0199a1b2-c3d4'))
    await waitFor(() => expect(useToasts.getState().items.map(item => item.title)).toContain('Resume command copied'))
    rerender(<AgentSessionDetails session={{ ...session, source: 'hook' }} resume={{ outcome: 'notResumed', agent: 'claude', sessionId: 'old', message: { code: 'agents.resume.sessionMissing', params: {} } }} />)
    expect(screen.getByTestId('pane-agent-session')).toHaveTextContent('Reported by the agent’s status hook')
    expect(screen.getByTestId('pane-agent-session')).toHaveTextContent(/Not resumed: .+/)
    expect(screen.getByTestId('pane-agent-session')).not.toHaveTextContent('agents.resume')
    rerender(<AgentSessionDetails session={{ source: 'notFound', message: { code: 'agents.session.notFound', params: {} } }} />)
    expect(screen.getByTestId('pane-agent-session')).not.toHaveTextContent('agents.session')
    expect(screen.queryByRole('button', { name: 'Copy resume command' })).toBeNull()
  })
})
