import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentRow } from '../../../shared/types/agents'
import type { Workspace } from '../../../shared/types/workspace'
import { NeedsYouPill } from '../../../src/components/Navigation/NeedsYouPill'
import { changeLanguage, i18n } from '../../../src/i18n'
import { useActivityStore } from '../../../src/store/activity.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

const SOURCES = { panes: { ok: true }, threads: { ok: true }, delegations: { ok: true }, work: { ok: true } }

const makeRequest = (requestId: string, since: number, command: string) => ({
  requestId,
  kind: 'approval',
  title: { code: 'agents.request.approval', params: {} },
  risk: 'low',
  reversible: null,
  answerable: true,
  since,
  command: { text: command, untrusted: true }
})

const threadNeedsYou = (requests: ReturnType<typeof makeRequest>[]): AgentRow => ({
  kind: 'thread',
  id: 'thread-1',
  state: 'needs-you',
  provider: 'claude',
  mode: 'thread',
  title: 'Auth',
  workspaceId: 'ws-1',
  since: 1,
  seenAt: null,
  session: null,
  worktree: null,
  cost: null,
  requests
}) as unknown as AgentRow

const agentRow = (id: string, state: 'failed' | 'working'): AgentRow => ({
  kind: 'thread',
  id,
  state,
  provider: 'codex',
  mode: 'thread',
  title: `Conversation ${id}`,
  workspaceId: 'ws-1',
  since: 5,
  seenAt: null,
  session: null,
  worktree: null,
  cost: null,
  requests: []
}) as unknown as AgentRow

let respond: ReturnType<typeof vi.fn>

function installFixture(agents: AgentRow[]): void {
  respond = vi.fn(async () => undefined)
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      thread: { respond },
      agents: {
        overview: vi.fn(async () => ({ agents, sources: SOURCES })),
        onChanged: vi.fn(() => () => undefined),
        markSeen: vi.fn(async () => undefined)
      }
    }
  })
  act(() => {
    useActivityStore.setState({ live: { code: {}, thread: {} }, waiting: { code: {}, thread: {} } } as never)
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: 'ws-1',
          name: 'demo-repo',
          rootPath: '/repo',
          panes: []
        } as unknown as Workspace
      ]
    } as never)
  })
}

async function openQueue(): Promise<HTMLElement> {
  const pill = await screen.findByTestId('needs-you-pill')
  fireEvent.click(pill)
  await waitFor(() => {
    expect(document.querySelector('[data-ui="needs-you-queue"]')).not.toBeNull()
  })
  return document.querySelector<HTMLElement>('[data-ui="needs-you-queue"]')!
}

describe('OXE-278 PE-09·A NeedsYouQueue', () => {
  beforeEach(() => {
    installFixture([
      threadNeedsYou([
        makeRequest('req-1', 1, 'git status'),
        makeRequest('req-2', 2, 'npm test')
      ])
    ])
  })

  afterEach(async () => {
    cleanup()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.density
    delete (window as { oxe?: unknown }).oxe
    vi.restoreAllMocks()
    await changeLanguage('en')
  })

  test('opens directly on the first pending request with zero repeated Needs you heading and preserves dialog aria-label across themes and densities', async () => {
    for (const locale of ['pt-BR', 'en'] as const) {
      await changeLanguage(locale)
      for (const theme of ['light', 'dark'] as const) {
        for (const density of ['compact', 'comfortable'] as const) {
          document.documentElement.dataset.theme = theme
          document.documentElement.dataset.density = density

          render(<NeedsYouPill />)
          const queue = await openQueue()

          expect(queue).toHaveAttribute('role', 'dialog')
          expect(queue).toHaveAttribute('aria-label', i18n.t('f7.queue.panelLabel', { ns: 'thread' }))

          // Zero popover titles and zero headings repeating "Precisa de você" / "Needs you".
          expect(queue.querySelectorAll('h1, h2, h3')).toHaveLength(0)

          const firstGroup = queue.firstElementChild as HTMLElement
          expect(firstGroup).toHaveAttribute('data-ui', 'needs-you-group')
          expect(firstGroup).toHaveAttribute('data-state', 'needs-you')

          const firstItem = firstGroup.firstElementChild as HTMLElement
          expect(firstItem).toHaveAttribute('data-ui', 'needs-you-item')
          expect(firstItem.querySelector('code')?.textContent).toBe('git status')

          // BRD-10 decision buttons keep size="md" and keyboard focus/actions stay intact.
          const buttons = within(firstItem).getAllByRole('button')
          expect(buttons).toHaveLength(2)
          for (const button of buttons) {
            expect(button).toHaveAttribute('data-ui', 'button')
            expect(button).toHaveAttribute('data-size', 'md')
          }

          expect(document.activeElement).toBe(firstItem)
          fireEvent.keyDown(firstItem, { key: 'j' })
          expect(document.activeElement).toBe(firstGroup.children[1])
          fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
          expect(document.querySelector('[data-ui="needs-you-queue"]')).toBeNull()

          cleanup()
        }
      }
    }
  })

  test('renders group headings with counts only on state transitions (failed and working)', async () => {
    installFixture([
      threadNeedsYou([makeRequest('req-1', 1, 'git status')]),
      agentRow('f-1', 'failed'),
      agentRow('w-1', 'working'),
      agentRow('w-2', 'working')
    ])

    for (const [locale, expectedFailed, expectedWorking] of [
      ['pt-BR', 'Falhou · 1', 'Trabalhando · 2'],
      ['en', 'Failed · 1', 'Working · 2']
    ] as const) {
      await changeLanguage(locale)
      render(<NeedsYouPill />)
      const queue = await openQueue()

      const needsGroup = queue.querySelector<HTMLElement>('[data-ui="needs-you-group"][data-state="needs-you"]')!
      expect(needsGroup.querySelectorAll('h3')).toHaveLength(0)

      const headings = [...queue.querySelectorAll<HTMLElement>('h3')].map(el => el.textContent?.trim())
      expect(headings).toEqual([expectedFailed, expectedWorking])

      cleanup()
    }
  })

  test('renders Next Ctrl+Shift+U once in the queue footer', async () => {
    for (const [locale, expectedFooter] of [
      ['pt-BR', 'Próximo Ctrl+Shift+U'],
      ['en', 'Next Ctrl+Shift+U']
    ] as const) {
      await changeLanguage(locale)
      render(<NeedsYouPill />)
      const queue = await openQueue()

      const footers = queue.querySelectorAll<HTMLElement>('[data-ui="needs-you-footer"]')
      expect(footers).toHaveLength(1)
      expect(queue.lastElementChild).toBe(footers[0])
      expect(footers[0].textContent?.replace(/\s+/g, ' ').trim()).toBe(expectedFooter)

      const matches = (queue.textContent ?? '').match(/Ctrl\+Shift\+U/g) ?? []
      expect(matches).toHaveLength(1)

      cleanup()
    }

    const css = readFileSync(join(process.cwd(), 'src/components/Navigation/NeedsYouQueue.module.css'), 'utf8')
    expect(css).toMatch(/\.footer\s*\{[^}]*font-size:\s*var\(--fs-xs\)/)
  })
})
