// Frozen acceptance test for 1.5.0 A61 on screen (DESIGN U9.3, OXE program, phase F9, task FE-A61). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f9-design.md (U9.3).
// Window only (BACKEND #721: per-mode UI state). The renderer parts:
// - useUIStore gains collapsedSidebars: Record<'code' | 'thread', boolean> and toggleSidebar(mode), each mode remembered
//   on its own across restarts (localStorage, read when the store starts);
// - SidebarCollapseButton({ mode }) in src/components/Sidebar/SidebarCollapseButton.tsx, the last action of both headers;
// - CodeRail({ workspaces, activeWorkspaceId, needsYou: ReadonlySet<string>, onSelect(id), onNewWorkspace() }) in
//   src/components/Sidebar/CodeRail.tsx; ThreadRail({ conversations: [{ id, title, needsYou? }], onSelect(id), onArchived() })
//   in src/components/Threads/ThreadRail.tsx. U9.3c (both rails' baselines in both themes) is the visual run.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Row = Record<string, unknown>
type Mode = 'code' | 'thread'
type UI = { collapsedSidebars: Record<Mode, boolean>; toggleSidebar(mode: Mode): void }
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
async function ui() {
  const { useUIStore } = await import('../../../src/store/ui.store')
  return useUIStore as unknown as { getState(): UI; setState(state: Partial<UI>): void }
}
const WORKSPACES = [
  { id: 'ws-1', name: 'cajui-api', rootPath: '/repo/cajui', themeId: 'midnight', color: '#e0a030', panes: [] },
  { id: 'ws-2', name: 'shop', rootPath: '/repo/shop', themeId: 'midnight', color: '#3080e0', panes: [] }
]

afterEach(async () => { cleanup(); localStorage.clear(); await changeLanguage('en') })

describe('U9.3 · Collapsing the sidebars', () => {
  test("Ctrl B toggles only the current mode's sidebar", async () => {
    const store = await ui()
    act(() => store.setState({ collapsedSidebars: { code: false, thread: false } }))
    act(() => store.getState().toggleSidebar('code'))
    expect(store.getState().collapsedSidebars).toEqual({ code: true, thread: false })
    act(() => store.getState().toggleSidebar('thread'))
    expect(store.getState().collapsedSidebars).toEqual({ code: true, thread: true })
    act(() => store.getState().toggleSidebar('code'))
    expect(store.getState().collapsedSidebars).toEqual({ code: false, thread: true })
    const { KEYBINDINGS } = await import('../../../src/keyboard/keybindings')
    expect(KEYBINDINGS.filter(binding => (binding.chords as readonly string[]).includes('Mod+B')).map(binding => binding.id as string)).toEqual(['sidebar.toggle'])
  })

  test('each mode is remembered on its own across a restart', async () => {
    const store = await ui()
    act(() => store.setState({ collapsedSidebars: { code: false, thread: false } }))
    act(() => store.getState().toggleSidebar('thread'))
    vi.resetModules()
    const { useUIStore } = await import('../../../src/store/ui.store')
    expect((useUIStore.getState() as unknown as UI).collapsedSidebars).toEqual({ code: false, thread: true })
  })

  test('the button is named for what it does, with Ctrl B, and toggles its own mode', async () => {
    const store = await ui()
    act(() => store.setState({ collapsedSidebars: { code: false, thread: false } }))
    const { SidebarCollapseButton } = await load<{ SidebarCollapseButton: (props: { mode: Mode }) => JSX.Element }>('src/components/Sidebar/SidebarCollapseButton')
    render(<SidebarCollapseButton mode="code" />)
    await userEvent.click(screen.getByRole('button', { name: 'Collapse the sidebar (Ctrl B)' }))
    expect(store.getState().collapsedSidebars).toEqual({ code: true, thread: false })
    expect(screen.getByRole('button', { name: 'Expand the sidebar (Ctrl B)' })).toBeInTheDocument()
  })

  test("OxeCode's rail: expand at the top, one named button per workspace with aria-current and the needs-you word, New workspace at the bottom", async () => {
    const { CodeRail } = await load<{ CodeRail: (props: Row) => JSX.Element }>('src/components/Sidebar/CodeRail')
    const onSelect = vi.fn()
    const onNewWorkspace = vi.fn()
    render(<CodeRail workspaces={WORKSPACES} activeWorkspaceId="ws-2" needsYou={new Set(['ws-1'])} onSelect={onSelect} onNewWorkspace={onNewWorkspace} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveAccessibleName('Expand the sidebar (Ctrl B)')
    expect(buttons.at(-1)).toHaveAccessibleName('New workspace')
    const cajui = screen.getByRole('button', { name: 'cajui-api, needs your decision' })
    const shop = screen.getByRole('button', { name: 'shop' })
    expect(shop).toHaveAttribute('aria-current', 'true')
    expect(cajui).not.toHaveAttribute('aria-current')
    await userEvent.click(cajui)
    expect(onSelect).toHaveBeenCalledWith('ws-1')
    await userEvent.click(buttons.at(-1)!)
    expect(onNewWorkspace).toHaveBeenCalledTimes(1)
  })

  test("OxeChat's rail: only expand at the top, every conversation kept as a named glyph, Archived at the bottom", async () => {
    const { ThreadRail } = await load<{ ThreadRail: (props: Row) => JSX.Element }>('src/components/Threads/ThreadRail')
    const conversations = Array.from({ length: 12 }, (_, index) => ({ id: `t-${index}`, title: `Task ${index}`, needsYou: index === 3 }))
    const onSelect = vi.fn()
    render(<ThreadRail conversations={conversations} onSelect={onSelect} onArchived={vi.fn()} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveAccessibleName('Expand the sidebar (Ctrl B)')
    expect(buttons.at(-1)).toHaveAccessibleName('Archived')
    expect(buttons.slice(1, -1)).toHaveLength(12)
    expect(screen.getByRole('button', { name: 'Task 3, needs your decision' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Task 7' }))
    expect(onSelect).toHaveBeenCalledWith('t-7')
  })

  test('the collapse button and the rails read in pt-BR', async () => {
    await changeLanguage('pt-BR')
    const store = await ui()
    act(() => store.setState({ collapsedSidebars: { code: false, thread: true } }))
    const { SidebarCollapseButton } = await load<{ SidebarCollapseButton: (props: { mode: Mode }) => JSX.Element }>('src/components/Sidebar/SidebarCollapseButton')
    render(<><SidebarCollapseButton mode="code" /><SidebarCollapseButton mode="thread" /></>)
    expect(screen.getByRole('button', { name: 'Recolher a barra lateral (Ctrl B)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expandir a barra lateral (Ctrl B)' })).toBeInTheDocument()
    cleanup()
    const { CodeRail } = await load<{ CodeRail: (props: Row) => JSX.Element }>('src/components/Sidebar/CodeRail')
    render(<CodeRail workspaces={WORKSPACES} activeWorkspaceId="ws-2" needsYou={new Set()} onSelect={vi.fn()} onNewWorkspace={vi.fn()} />)
    expect(within(document.body).getByRole('button', { name: 'Novo workspace' })).toBeInTheDocument()
  })
})
