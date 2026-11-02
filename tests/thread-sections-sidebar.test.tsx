import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadSidebar } from '../src/components/Threads/ThreadSidebar'
import { normalizeThreadSections } from '../shared/thread-sections'
import type { ThreadSections } from '../shared/types/thread-sections'
import { LEGACY_STORAGE_PREFIX, resetSectionsForTests, sectionsApi } from '../src/components/Threads/sections/sectionsApi'
import { THREAD_DRAG_TYPE } from '../src/components/Threads/sections/useSectionDrag'
import { useThreadStore } from '../src/store/thread.store'
import type { ConversationThread, ThreadApi } from '../shared/types/thread'

const base: ConversationThread = { id: 'a', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Alpha', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 3, updatedAt: 3 }

function fixture() {
  const threads = [base, { ...base, id: 'b', title: 'Bravo', createdAt: 2 }, { ...base, id: 'child', title: 'Nested', createdAt: 1, parentThreadId: 'a' } as ConversationThread]
  // Main's two section channels, in memory, checked by the shared validator main uses.
  const stored = new Map<string, ThreadSections>()
  const api = { list: vi.fn(async () => threads), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), onChanged: vi.fn(() => () => {}),
    sections: vi.fn(async (workspaceId: string) => structuredClone(stored.get(workspaceId) ?? { sections: [], assignments: {} })),
    saveSections: vi.fn(async (workspaceId: string, state: ThreadSections) => {
      const result = normalizeThreadSections(state, id => threads.some(item => item.id === id))
      if (result.ok) stored.set(workspaceId, structuredClone(result.state))
      return result
    }) } as unknown as ThreadApi
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api } })
  useThreadStore.setState({ threads, projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], selectedId: null, secondaryId: null, errors: {}, hiddenProjects: [], expanded: {}, unreadIds: [] })
  // Sections this window kept before main did: the first load moves them to main.
  localStorage.setItem(`${LEGACY_STORAGE_PREFIX}project`, JSON.stringify({ sections: [{ id: 'work', projectId: 'project', name: 'Work', order: 0, collapsed: false, createdAt: 1 }], assignments: { a: 'work' } }))
}

const region = (name: string) => screen.getByRole('region', { name })
const titlesIn = (element: HTMLElement) => [...element.querySelectorAll('.thread-session-title')].map(node => node.textContent)

beforeEach(() => { localStorage.clear(); resetSectionsForTests() })
afterEach(() => { cleanup() })

describe('sections in the conversation list', () => {
  it('shows a section with its conversations and count; a nested conversation follows its parent', async () => {
    fixture()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await waitFor(() => expect(titlesIn(region('Work'))).toEqual(['Alpha', 'Nested']))
    expect(within(region('Work')).getByText('2 conversations')).toBeInTheDocument()
    expect(titlesIn(document.querySelector('.thread-project-rows')!)).toEqual(['Bravo'])
  })

  it('moves a conversation with the menu, and a nested one cannot be moved', async () => {
    fixture()
    const user = userEvent.setup()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await waitFor(() => expect(region('Work')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Actions for Bravo' }))
    const submenu = screen.getByRole('menuitem', { name: 'Move to section' })
    submenu.focus()
    await user.keyboard('{ArrowRight}')
    await user.click(await screen.findByRole('menuitemradio', { name: 'Work' }))
    await waitFor(() => expect(titlesIn(region('Work'))).toEqual(['Alpha', 'Bravo', 'Nested']))

    await user.click(screen.getByRole('button', { name: 'Actions for Nested' }))
    expect(screen.getByRole('menuitem', { name: 'Section follows the parent conversation' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('says each move and delete in a polite live region, and a menu move gives the focus to the moved row', async () => {
    fixture()
    const user = userEvent.setup()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await waitFor(() => expect(region('Work')).toBeInTheDocument())
    const announcer = screen.getByTestId('thread-sections-announcer')
    expect(announcer).toHaveAttribute('aria-live', 'polite')
    await user.click(screen.getByRole('button', { name: 'Actions for Bravo' }))
    screen.getByRole('menuitem', { name: 'Move to section' }).focus()
    await user.keyboard('{ArrowRight}')
    await user.click(await screen.findByRole('menuitemradio', { name: 'Work' }))
    await waitFor(() => expect(announcer).toHaveTextContent('Moved Bravo to Work'))
    await waitFor(() => expect(document.activeElement?.closest('[data-thread-row]')?.getAttribute('data-thread-row')).toBe('b'))

    await user.click(within(region('Work')).getByRole('button', { name: 'Actions for section Work' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete section…' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete this section?' })).getByRole('button', { name: 'Delete section' }))
    await waitFor(() => expect(announcer).toHaveTextContent('Section deleted; 3 conversations went back to No section'))
  })

  it('drags a conversation into no section, the same move as the menu', async () => {
    fixture()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await waitFor(() => expect(region('Work')).toBeInTheDocument())
    const data = new Map<string, string>()
    const dataTransfer = { types: [THREAD_DRAG_TYPE], setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? '', effectAllowed: '', dropEffect: '' }
    const alpha = screen.getByText('Alpha').closest('.thread-navigation-row')!
    expect(alpha).toHaveAttribute('draggable', 'true')
    expect(screen.getByText('Nested').closest('.thread-navigation-row')).not.toHaveAttribute('draggable')
    fireEvent.dragStart(alpha, { dataTransfer })
    const loose = document.querySelector('.thread-project-rows')!
    const over = createEvent.dragOver(loose, { dataTransfer })
    fireEvent(loose, over)
    expect(over.defaultPrevented).toBe(true)
    fireEvent.drop(loose, { dataTransfer })
    await waitFor(() => expect(titlesIn(document.querySelector('.thread-project-rows')!)).toEqual(['Alpha', 'Bravo', 'Nested']))
    expect(region('Work')).toHaveTextContent('Drag a conversation here')
  })

  it('collapses a section and keeps it collapsed', async () => {
    fixture()
    const user = userEvent.setup()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    const toggle = await within(await screen.findByRole('region', { name: 'Work' })).findByRole('button', { name: /^Work/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'))
    expect(titlesIn(region('Work'))).toEqual([])
    expect((await sectionsApi().listSections('project'))[0].collapsed).toBe(true)
  })

  it('creates a section from the project menu and explains an invalid name', async () => {
    fixture()
    const user = userEvent.setup()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Actions for Repo' }))
    await user.click(screen.getByRole('menuitem', { name: 'New section…' }))
    const dialog = screen.getByRole('dialog', { name: 'New section' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Section name' }), 'x'.repeat(61))
    await user.click(within(dialog).getByRole('button', { name: 'Create section' }))
    expect(within(dialog).getByText('Use 1 to 60 characters, without line breaks or control characters.')).toBeInTheDocument()
    await user.clear(within(dialog).getByRole('textbox', { name: 'Section name' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Section name' }), 'Later')
    await user.click(within(dialog).getByRole('button', { name: 'Create section' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(region('Later')).toHaveTextContent('Drag a conversation here')
  })

  it('explains a duplicate name in the dialog', async () => {
    fixture()
    const user = userEvent.setup()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Actions for Repo' }))
    await user.click(screen.getByRole('menuitem', { name: 'New section…' }))
    const dialog = screen.getByRole('dialog', { name: 'New section' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Section name' }), 'work')
    await user.click(within(dialog).getByRole('button', { name: 'Create section' }))
    expect(await within(dialog).findByText('Another section in this project already has this name.')).toBeInTheDocument()
  })

  it('a right click, Shift+F10 or the menu key on a conversation opens the same menu as its "…" button', async () => {
    fixture()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await waitFor(() => expect(titlesIn(region('Work'))).toEqual(['Alpha', 'Nested']))
    const row = screen.getAllByRole('button', { name: /^Bravo/ })[0]!
    fireEvent.contextMenu(row)
    expect(await screen.findByRole('menu', { name: 'Actions for Bravo' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    for (const key of [{ key: 'F10', shiftKey: true }, { key: 'ContextMenu' }]) {
      fireEvent.keyDown(row, key)
      expect(await screen.findByRole('menu', { name: 'Actions for Bravo' })).toBeInTheDocument()
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    }
  })

  it('says "0 conversas" for an empty section in Portuguese', async () => {
    const { changeLanguage, i18n } = await import('../src/i18n')
    await changeLanguage('pt-BR')
    try {
      expect(i18n.t('thread:sections.count', { count: 0 })).toBe('0 conversas')
      expect(i18n.t('thread:sections.count', { count: 1 })).toBe('1 conversa')
    } finally { await changeLanguage('en') }
    expect(i18n.t('thread:sections.count', { count: 0 })).toBe('0 conversations')
  })

  it("reads a project's sections from main under the project's own key; what main keeps wins over a local copy", async () => {
    fixture()
    const thread = window.oxe.thread as unknown as { sections: ReturnType<typeof vi.fn>; saveSections: ReturnType<typeof vi.fn> }
    thread.sections.mockResolvedValue({ sections: [{ id: 'real', name: 'From main', order: 0, collapsed: false }], assignments: { b: 'real' } })
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await waitFor(() => expect(titlesIn(region('From main'))).toEqual(['Bravo']))
    expect(thread.sections).toHaveBeenCalledWith('thread:project')
    expect(thread.saveSections).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Work' })).toBeNull()
  })
})
