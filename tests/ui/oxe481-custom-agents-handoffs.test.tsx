import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CustomAgentDefinition } from '../../shared/types/custom-agents'
import type { Workspace } from '../../shared/types/workspace'
import { ThreadView } from '../../src/components/Threads/ThreadView'
import { changeLanguage, i18n } from '../../src/i18n'
import { useAccountStore } from '../../src/store/account.store'
import { useThreadStore } from '../../src/store/thread.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

vi.mock('../../src/hooks/useGitBranch', () => ({
  useGitBranch: () => ({ branch: 'feat/oxe-481', detached: false, shortSha: null, error: null })
}))

const CUSTOM_AGENTS: CustomAgentDefinition[] = [
  {
    id: 'architect',
    name: 'Architect',
    description: 'Plans system changes before coding',
    mode: 'plan',
    handoffs: [
      {
        label: 'Implement plan',
        agent: 'agent',
        mode: 'agent',
        prompt: 'Implement the approved design now.',
        send: false
      },
      {
        label: 'Run security review',
        agent: 'reviewer',
        prompt: 'Audit this design for security issues.',
        send: true
      }
    ],
    instructions: 'Write a concise architectural plan first.',
    source: 'oxe',
    sourcePath: '.oxe/agents/architect.md'
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Read-only security reviewer',
    mode: 'ask',
    access: 'read-only',
    handoffs: [],
    instructions: 'Audit diffs without editing files.',
    source: 'github',
    sourcePath: '.github/agents/reviewer.agent.md'
  }
]

const tt = (key: string, options: Record<string, unknown> = {}): string =>
  i18n.t(key, { ns: 'thread', ...options }) as string

function setupFixture(options: {
  events?: unknown[]
  thread?: Record<string, unknown>
  customAgents?: CustomAgentDefinition[]
} = {}) {
  const thread: Record<string, unknown> = {
    id: 'thread-1',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    rootPath: '/repo',
    provider: 'claude',
    title: 'OXE-481 test',
    pinned: false,
    status: 'idle',
    nativeSessionId: 'native-1',
    createdAt: 1,
    updatedAt: 1,
    access: 'workspace-write',
    mode: 'default',
    configurationRevision: 0,
    ...options.thread
  }
  let currentSnapshot = { thread, events: options.events ?? [] }

  const configure = vi.fn(async (_id: string, patch: Record<string, unknown>, revision: number) => {
    const nextThread: Record<string, unknown> = {
      ...currentSnapshot.thread,
      ...patch,
      configurationRevision: revision + 1
    }
    if (patch.customAgentId === null || patch.customAgentId === '') {
      delete nextThread.customAgentId
    }
    currentSnapshot = { ...currentSnapshot, thread: nextThread }
    return currentSnapshot
  })
  const send = vi.fn(async () => {})
  const listCustomAgents = vi.fn(async () => options.customAgents ?? CUSTOM_AGENTS)
  const api = {
    commands: vi.fn(async () => ({ commands: [] })),
    projects: vi.fn(async () => ({ projects: [], unavailable: [] })),
    list: vi.fn(async () => [currentSnapshot.thread]),
    create: vi.fn(async () => currentSnapshot),
    read: vi.fn(async () => currentSnapshot),
    models: vi.fn(async () => ({
      defaultModel: 'native-model',
      models: [{ id: 'native-model', label: 'Native model', description: '', efforts: ['low', 'high'], defaultEffort: 'low' }]
    })),
    configure,
    listCustomAgents,
    send,
    steer: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    approve: vi.fn(async () => {}),
    respond: vi.fn(async () => {}),
    pin: vi.fn(async () => {}),
    onChanged: vi.fn(() => () => {}),
    command: vi.fn(async () => ({ kind: 'applied' })),
    turnFiles: vi.fn(async () => []),
    places: vi.fn(async () => ({ places: [], capped: false, refused: 0 })),
    onPlacesChanged: vi.fn(() => () => {}),
    collisions: vi.fn(async () => [])
  }

  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      thread: api,
      clipboard: { writeText: vi.fn(async () => true) },
      agentAccount: {
        read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 }))
      }
    }
  })

  const workspace = { id: 'ws-1', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({
    threads: [currentSnapshot.thread],
    projects: [{ projectId: 'proj-1', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }],
    snapshot: currentSnapshot,
    selectedId: 'thread-1',
    secondaryId: null,
    drafts: {},
    attachments: {},
    previewElements: {},
    contextItems: {}
  } as never)

  return { workspace, api, configure, send, listCustomAgents }
}

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-481 · calm mode selector, Ask mode, and declarative handoffs', () => {
  test('keeps [Agent | Plan] calm at rest and offers Ask + custom agents in the dropdown', async () => {
    const fx = setupFixture()
    render(<ThreadView workspace={fx.workspace} />)

    await waitFor(() => expect(fx.listCustomAgents).toHaveBeenCalledWith('/repo'))

    const modeSwitch = document.querySelector('[data-ui="mode-switch"]') as HTMLElement
    expect(modeSwitch).toBeTruthy()
    const segments = [...modeSwitch.querySelectorAll('button')].map(el => el.textContent?.trim())
    expect(segments).toEqual([tt('config.agent'), tt('config.plan')])

    const moreTrigger = screen.getByRole('button', { name: tt('config.moreModes') })
    await userEvent.click(moreTrigger)

    const menu = await screen.findByRole('menu', { name: tt('config.moreModes') })
    expect(within(menu).getByRole('menuitemradio', { name: tt('config.ask') })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Architect' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Reviewer' })).toBeInTheDocument()

    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Reviewer' }))
    await waitFor(() => expect(fx.configure).toHaveBeenCalledWith('thread-1', { mode: 'ask', customAgentId: 'reviewer' }, 0))

    expect(screen.getByRole('button', { name: `${tt('config.moreModes')}: Reviewer` })).toBeInTheDocument()
  })

  test('renders declarative handoff bar after a completed turn and pre-fills or auto-sends on click', async () => {
    const completedEvents = [
      { type: 'message', id: 'u1', role: 'user', text: 'Design the auth migration' },
      { type: 'message', id: 'a1', role: 'assistant', text: 'Here is the phased architecture plan.' },
      { type: 'completed', status: 'completed' }
    ]
    const fx = setupFixture({
      events: completedEvents,
      thread: { mode: 'plan', customAgentId: 'architect' }
    })
    render(<ThreadView workspace={fx.workspace} />)

    const bar = await screen.findByRole('region', { name: tt('handoffs.region') })
    expect(bar).toHaveTextContent(tt('handoffs.proceedFrom', { name: 'Architect' }))

    // Handoff 1: send=false -> switches mode to agent, clears custom agent, pre-fills composer draft without auto-sending
    await userEvent.click(within(bar).getByRole('button', { name: 'Implement plan' }))
    await waitFor(() => expect(fx.configure).toHaveBeenCalledWith('thread-1', { mode: 'default', customAgentId: null }, 0))
    expect(fx.send).not.toHaveBeenCalled()
    expect(useThreadStore.getState().drafts['thread-1']).toBe('Implement the approved design now.')
  })

  test('auto-sends when a declarative handoff sets send: true', async () => {
    const completedEvents = [
      { type: 'message', id: 'u1', role: 'user', text: 'Design the auth migration' },
      { type: 'message', id: 'a1', role: 'assistant', text: 'Plan ready.' },
      { type: 'completed', status: 'completed' }
    ]
    const fx = setupFixture({
      events: completedEvents,
      thread: { mode: 'plan', customAgentId: 'architect' }
    })
    render(<ThreadView workspace={fx.workspace} />)

    const bar = await screen.findByRole('region', { name: tt('handoffs.region') })
    await userEvent.click(within(bar).getByRole('button', { name: 'Run security review' }))

    await waitFor(() => expect(fx.configure).toHaveBeenCalledWith('thread-1', { mode: 'ask', customAgentId: 'reviewer' }, 0))
    await waitFor(() => expect(fx.send).toHaveBeenCalledWith('thread-1', 'Audit this design for security issues.', []))
  })

  test('generalizes Plan -> Implement handoff bar when in Plan mode without explicit executePlan action', async () => {
    const completedEvents = [
      { type: 'message', id: 'u1', role: 'user', text: 'Plan the refactor' },
      { type: 'message', id: 'a1', role: 'assistant', text: 'Step 1, Step 2' },
      { type: 'completed', status: 'completed' }
    ]
    const fx = setupFixture({
      events: completedEvents,
      thread: { mode: 'plan', access: 'workspace-write' },
      customAgents: []
    })
    render(<ThreadView workspace={fx.workspace} />)

    const bar = await screen.findByRole('region', { name: tt('handoffs.region') })
    expect(bar).toHaveTextContent(tt('handoffs.proceedFrom', { name: tt('config.plan') }))
    await userEvent.click(within(bar).getByRole('button', { name: tt('handoffs.implementPlan') }))

    await waitFor(() => expect(fx.configure).toHaveBeenCalledWith('thread-1', { mode: 'default', customAgentId: null }, 0))
    expect(useThreadStore.getState().drafts['thread-1']).toContain('Carry out the plan above')
  })
})
