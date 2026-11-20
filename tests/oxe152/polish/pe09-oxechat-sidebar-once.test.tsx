// @vitest-environment jsdom
// Acceptance test for 1.5.2/1.5.3 PE-09·C (Jira OXE-280): OxeChat sidebar says "Conversas" once (short Filter placeholder + zero footer counter).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../../../src/components/Threads/sections/sectionsApi'
import { useNavigationPrefs } from '../../../src/store/navigation-prefs.store'
import { useSettingsStore } from '../../../src/store/settings.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useUIStore } from '../../../src/store/ui.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { ConversationThread, ThreadApi, ThreadProjectSummary } from '../../../shared/types/thread'

const ROOT = process.cwd()
const tt = (key: string): string => i18n.t(key, { ns: 'thread' }) as string

const PROJECT: ThreadProjectSummary = {
  projectId: 'p1',
  displayName: 'Atlas',
  identityLabel: '/repos/p1',
  hidden: false,
  contexts: [{ rootPath: '/repos/p1', label: 'Atlas' }]
}

const makeThread = (id: string, title: string, extra: Partial<ConversationThread> = {}): ConversationThread => ({
  id,
  workspaceId: 'thread:p1',
  projectId: 'p1',
  rootPath: '/repos/p1',
  provider: 'claude',
  title,
  pinned: false,
  status: 'idle',
  nativeSessionId: null,
  createdAt: 100,
  updatedAt: Date.now() - 60_000,
  ...extra
} as ConversationThread)

const THREADS = [
  makeThread('t-1', 'Fix login flow', { createdAt: 200 }),
  makeThread('t-2', 'Prepare release notes', { createdAt: 150 }),
  makeThread('t-arch', 'Old archived spike', { archived: true, createdAt: 50 } as Partial<ConversationThread>)
]

const SESSIONS = THREADS.map(thread => ({
  id: thread.id,
  rootPath: thread.rootPath,
  chats: [{ id: thread.id, provider: thread.provider, main: true, status: thread.status, changes: { additions: 0, deletions: 0 } }],
  openChatId: thread.id,
  archived: Boolean((thread as { archived?: boolean }).archived),
  changes: { additions: 0, deletions: 0 }
}))

function installFixture(): void {
  const api = {
    list: vi.fn(async () => THREADS),
    projects: vi.fn(async () => ({ projects: [PROJECT], unavailable: [] })),
    read: vi.fn(async (id: string) => ({ thread: THREADS.find(item => item.id === id)!, events: [] })),
    command: vi.fn(async () => undefined),
    onChanged: vi.fn(() => () => {}),
    sections: vi.fn(async () => ({ sections: [], assignments: {} })),
    saveSections: vi.fn(async (_workspaceId: string, state: unknown) => ({ ok: true, state })),
    pendingRequestsAll: vi.fn(async () => []),
    respondPending: vi.fn(async () => ({ ok: true })),
    sessions: vi.fn(async () => SESSIONS),
    onPlacesChanged: vi.fn(() => () => {})
  }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api as unknown as ThreadApi } })
  useThreadStore.setState({
    threads: THREADS,
    projects: [PROJECT],
    unavailableProjects: [],
    loading: false,
    listLoaded: true,
    selectedId: 't-1',
    secondaryId: null,
    snapshot: null,
    snapshotCache: {},
    snapshotCacheOrder: [],
    errors: {},
    hiddenProjects: [],
    expanded: {},
    unreadIds: []
  } as never)
  useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })
  useNavigationPrefs.setState({ width: 280, expanded: {}, threadDensity: null })
}

beforeEach(() => {
  localStorage.clear()
  resetSectionsForTests()
  installFixture()
})

afterEach(async () => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-280 · PE-09·C OxeChat sidebar says Conversas once', () => {
  test('uses short Filter placeholder while keeping Filter conversations aria-label across pt-BR, en, themes and densities', async () => {
    const brd02 = JSON.parse(readFileSync(join(ROOT, 'src/design/targets/brd-02.json'), 'utf8')) as {
      measures: Array<{ id: string; state: string; expect: Record<string, unknown> }>
    }
    const enforced = (JSON.parse(readFileSync(join(ROOT, 'src/design/targets/enforced.lock.json'), 'utf8')) as {
      enforced: string[]
    }).enforced
    const filterMeasure = brd02.measures.find(m => m.id === 'BRD-02.filter.height')
    expect(filterMeasure?.state).toBe('enforced')
    expect(filterMeasure?.expect).toEqual({ token: '--control-md' })
    expect(enforced).toContain('BRD-02.filter.height')

    const locales: Array<{ lang: 'pt-BR' | 'en'; placeholder: string; ariaLabel: string; heading: string }> = [
      { lang: 'pt-BR', placeholder: 'Filtrar…', ariaLabel: 'Filtrar conversas', heading: 'Conversas' },
      { lang: 'en', placeholder: 'Filter…', ariaLabel: 'Filter conversations', heading: 'Conversations' }
    ]

    for (const { lang, placeholder, ariaLabel, heading } of locales) {
      await changeLanguage(lang)
      for (const theme of ['light', 'dark'] as const) {
        for (const density of ['compact', 'comfortable'] as const) {
          document.documentElement.setAttribute('data-theme', theme)
          document.documentElement.setAttribute('data-density', density)
          useSettingsStore.setState({ density } as never)

          const { unmount } = render(
            <ThreadSidebar onCreate={vi.fn()} onAccounts={vi.fn()} onAddProject={vi.fn()} onOpenInCode={vi.fn(async () => undefined)} />
          )
          const aside = screen.getByRole('complementary', { name: tt('sidebar.region') })
          await waitFor(() => expect(within(aside).getByText('Fix login flow')).toBeInTheDocument())

          const header = aside.querySelector<HTMLElement>('[data-ui="sidebar-header"]')!
          expect(header).toHaveTextContent(heading)

          const filterBox = within(aside).getByRole('searchbox', { name: ariaLabel })
          expect(filterBox, `${lang}/${theme}/${density}: placeholder`).toHaveAttribute('placeholder', placeholder)
          expect(filterBox, `${lang}/${theme}/${density}: aria-label`).toHaveAttribute('aria-label', ariaLabel)
          expect(filterBox.getAttribute('placeholder')).not.toContain(heading.toLowerCase())

          unmount()
        }
      }
    }
  })

  test('renders zero conversation counter in footer while keeping Archived group in the tree', async () => {
    const cases: Array<{ lang: 'pt-BR' | 'en'; archivedLabel: string; countPattern: RegExp }> = [
      { lang: 'pt-BR', archivedLabel: 'Arquivadas', countPattern: /\b\d+\s+conversas?\b/i },
      { lang: 'en', archivedLabel: 'Archived', countPattern: /\b\d+\s+conversations?\b/i }
    ]

    for (const { lang, archivedLabel, countPattern } of cases) {
      await changeLanguage(lang)
      const { unmount } = render(
        <ThreadSidebar onCreate={vi.fn()} onAccounts={vi.fn()} onAddProject={vi.fn()} onOpenInCode={vi.fn(async () => undefined)} />
      )
      const aside = screen.getByRole('complementary', { name: tt('sidebar.region') })
      await waitFor(() => expect(within(aside).getByText('Fix login flow')).toBeInTheDocument())

      const footer = aside.querySelector<HTMLElement>('[data-ui="sidebar-footer"]')
      expect(footer, `${lang}: sidebar footer`).not.toBeNull()
      expect(footer!.textContent ?? '', `${lang}: zero conversation counter in footer`).not.toMatch(countPattern)
      expect(aside.querySelectorAll('.thread-archived-bar')).toHaveLength(0)

      const archivedSection = aside.querySelector<HTMLElement>('.thread-archived-section')
      expect(archivedSection, `${lang}: Archived group in tree`).not.toBeNull()
      const archivedToggle = within(archivedSection!).getByRole('button', { name: `${archivedLabel} 1` })
      expect(archivedToggle).toHaveAttribute('aria-expanded', 'false')
      expect(within(aside).queryByText('Old archived spike')).toBeNull()

      fireEvent.click(archivedToggle)
      expect(archivedToggle).toHaveAttribute('aria-expanded', 'true')
      expect(within(archivedSection!).getByText('Old archived spike')).toBeInTheDocument()

      unmount()
    }
  })
})
