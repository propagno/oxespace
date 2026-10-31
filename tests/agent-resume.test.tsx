import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentHooksStatus } from '../shared/types/agent-hooks'
import type { PaneAgentResume } from '../shared/types/ipc/terminal'
import { AgentHooksPromptHost } from '../src/components/AgentSessions/AgentHooksPromptHost'
import { EnableResumeMenuItem, PaneResumeMarker, usePaneResume } from '../src/components/AgentSessions/PaneResume'
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

function Pane({ id, agent, running = true }: { id: string; agent: ResumeAgent | null; running?: boolean }) {
  const outcome = usePaneResume(id, `Pane ${id}`, running, agent)
  return <div data-testid={`pane-${id}`}>{outcome && <PaneResumeMarker outcome={outcome} />}{agent && <EnableResumeMenuItem agent={agent} onDone={run => run()} />}</div>
}

const toastTitles = (): string[] => useToasts.getState().items.map(item => item.title)

beforeEach(() => { localStorage.clear(); useAgentResumeStore.getState().reset(); useToasts.setState({ items: [] }) })
afterEach(async () => { cleanup(); delete (window as unknown as { oxe?: unknown }).oxe; await changeLanguage('en') })

describe('what became of a pane\'s earlier session', () => {
  it('a resumed pane says so, with the agent and the session', async () => {
    const api = install({ a: { outcome: 'resumed', agent: 'claude', sessionId: '0199a1b2-c3d4-7e5f' } })
    render(<Pane id="a" agent="claude" />)
    const marker = await screen.findByTestId('pane-resume-marker')
    expect(marker).toHaveTextContent('Resumed')
    expect(marker).toHaveAccessibleName('Resumed the earlier Claude session 0199a1b2')
    expect(marker).toHaveAttribute('title', expect.stringContaining('0199a1b2-c3d4-7e5f'))
    // Read once, however often the pane renders.
    cleanup(); render(<Pane id="a" agent="claude" />)
    await screen.findByTestId('pane-resume-marker')
    expect(api.terminal.status).toHaveBeenCalledTimes(1)
  })

  it('a session that was not resumed says why, in the interface language, once', async () => {
    await changeLanguage('pt-BR')
    install({ b: { outcome: 'notResumed', agent: 'codex', sessionId: 'abcdef12-99', message: { code: 'agents.resume.sessionMissing', params: {} } } })
    render(<Pane id="b" agent="codex" />)
    const marker = await screen.findByTestId('pane-resume-marker')
    expect(marker).toHaveTextContent('Não retomada')
    expect(marker.getAttribute('aria-label')).toMatch(/^A sessão anterior do Codex não foi retomada: /)
    expect(marker.getAttribute('aria-label')).not.toContain('agents.resume')
    await waitFor(() => expect(toastTitles()).toEqual(['Pane b: a sessão anterior não foi retomada']))
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
  it('asks once per run when the agent\'s hooks are missing, and "Install" installs them', async () => {
    const api = install({}, { 'claude-code': 'not_installed' })
    const user = userEvent.setup()
    render(<><Pane id="a" agent="claude" /><Pane id="b" agent="claude" /><AgentHooksPromptHost /></>)
    const dialog = await screen.findByRole('dialog', { name: 'Let Claude Code panes come back after a crash?' })
    expect(dialog).toHaveTextContent('~/.claude')
    expect(dialog).toHaveTextContent('Settings › Notifications')
    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(api.agentHooks.install).toHaveBeenCalledWith('claude-code')
    await waitFor(() => expect(toastTitles()).toContain('Claude Code panes now record their sessions'))
    expect(screen.queryByRole('dialog')).toBeNull()
    // Installed: the menu no longer offers it.
    expect(screen.queryByTestId('pane-enable-resume')).toBeNull()
  })

  it('"Not now" waits for the next run; "Don\'t ask again" never asks, but the pane\'s menu still can', async () => {
    install({}, { codex: 'not_installed' })
    const user = userEvent.setup()
    const { unmount } = render(<><Pane id="a" agent="codex" /><AgentHooksPromptHost /></>)
    await user.click(await screen.findByRole('button', { name: 'Not now' }))
    unmount()
    render(<><Pane id="b" agent="codex" /><AgentHooksPromptHost /></>)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()

    // Next run.
    useAgentResumeStore.getState().reset()
    render(<><Pane id="c" agent="codex" /><AgentHooksPromptHost /></>)
    await user.click(await screen.findByRole('button', { name: "Don't ask again" }))
    cleanup()
    useAgentResumeStore.getState().reset()
    render(<><Pane id="d" agent="codex" /><AgentHooksPromptHost /></>)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.queryByRole('dialog')).toBeNull()
    // Asked for, it asks.
    await user.click(await screen.findByTestId('pane-enable-resume'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('reads in pt-BR, and never asks when the hooks are installed or the pane runs another agent', async () => {
    await changeLanguage('pt-BR')
    install({}, { 'claude-code': 'not_installed' })
    render(<><Pane id="a" agent="claude" /><AgentHooksPromptHost /></>)
    const dialog = await screen.findByRole('dialog', { name: 'Deixar os painéis do Claude Code voltarem após um travamento?' })
    expect(dialog).toHaveTextContent('Configurações › Notificações')
    for (const name of ['Instalar', 'Agora não', 'Não perguntar de novo']) expect(screen.getByRole('button', { name })).toBeInTheDocument()
    cleanup(); useAgentResumeStore.getState().reset()
    install({}, {})
    render(<><Pane id="b" agent="claude" /><Pane id="c" agent={null} /><AgentHooksPromptHost /></>)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
