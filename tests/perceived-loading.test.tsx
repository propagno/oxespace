import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Suspense, type ReactElement } from 'react'
import { SidebarSkeleton } from '../src/ui'
import { chunk, lazyFrom } from '../src/lib/chunk'
import { ErrorBoundary } from '../src/components/common/ErrorBoundary'
import { FirstRunChecklistFallback } from '../src/components/Onboarding/FirstRunChecklistFallback'
import type { Workspace } from '../shared/types/workspace'

// The Settings pages' chunk stays pending until a test lets it through: the frame is what the first click shows.
const gate = vi.hoisted(() => { let open: () => void = () => undefined; const ready = new Promise<void>(resolve => { open = resolve }); return { ready, open: () => open() } })
vi.mock('../src/components/Settings/settingsPages', async () => {
  await gate.ready
  const Page = ({ section }: { section?: string }) => <section data-testid="settings-page">{section ?? 'page'}</section>
  return { SettingsContent: Page, WorkspaceSettingsModal: Page, PolicySettings: Page, KeyboardSettings: Page }
})
const { SettingsCenter, SETTINGS_FRAME } = await import('../src/components/Settings/SettingsHost')
// The idle preload loads the frame before anyone clicks Settings (src/lib/idlePreload.ts); with it loaded, the
// lazy frame renders at once, which is what this test is about.
await SETTINGS_FRAME.load()

afterEach(() => cleanup())

describe('view sidebar skeleton', () => {
  it('is a busy region with the header, silent: the work area announces the one loading', () => {
    render(<SidebarSkeleton label="OxePod sidebar" title="OxePod" />)
    const region = screen.getByRole('complementary', { name: 'OxePod sidebar' })
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(region).toHaveClass('thread-navigation')
    expect(region).toHaveTextContent('OxePod')
    expect(screen.queryAllByRole('status')).toHaveLength(0)
    expect(region.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(1)
  })

  it('collapsed to the rail it stays busy and silent, without the header', () => {
    render(<SidebarSkeleton label="Thread sidebar" title="Conversations" collapsed />)
    const region = screen.getByRole('complementary', { name: 'Thread sidebar' })
    expect(region).toHaveClass('thread-navigation-collapsed')
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryAllByRole('status')).toHaveLength(0)
    expect(region).not.toHaveTextContent('Conversations')
  })
})

describe('Settings opening', () => {
  const workspace = { id: 'ws', name: 'demo', rootPath: '/repo', themeId: 'midnight', uiDensity: 'comfortable', layoutPreset: 4, defaultShellProfileId: 'sh', panes: [] } as unknown as Workspace
  it('opens one dialog at once, with the loading in its content area, and the page fills that same dialog', async () => {
    const onClose = vi.fn()
    render(<SettingsCenter initialPage="providers" workspaces={[workspace]} shellProfiles={[]} onSave={vi.fn()} onClose={onClose} allowWorkspaceScope={false} />)
    const dialog = screen.getByRole('dialog', { name: /Settings/ })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(dialog).toHaveClass('settings-center')
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeInTheDocument()

    await act(async () => { gate.open(); await gate.ready; await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(await screen.findByTestId('settings-page')).toHaveTextContent('providers')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: /Settings/ })).toBe(dialog)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('a lazy part that fails to load', () => {
  it('shows its error in its own place, and Try again loads the chunk again', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      let attempts = 0
      const source = chunk(() => ++attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ Sidebar: () => <p>sidebar rows</p> }))
      const Sidebar = lazyFrom(source, module => module.Sidebar)
      render(<main><h1>window</h1><ErrorBoundary compact label="OxePod" onReset={Sidebar.retry}><Suspense fallback={<p>loading</p>}><Sidebar /></Suspense></ErrorBoundary></main>)
      const retry = await screen.findByRole('button', { name: /try again/i })
      expect(screen.getByRole('heading', { name: 'window' })).toBeInTheDocument()
      fireEvent.click(retry)
      expect(await screen.findByText('sidebar rows')).toBeInTheDocument()
      expect(attempts).toBe(2)
    } finally { quiet.mockRestore() }
  })
})

describe('first-run checklist fallback', () => {
  it('holds the card\'s place without announcing anything', () => {
    const { container } = render(<FirstRunChecklistFallback />)
    const card = container.firstElementChild as HTMLElement
    expect(card).toHaveAttribute('aria-hidden', 'true')
    expect(card.className).toMatch(/card/)
    expect(card.className).toMatch(/fallback/)
    expect(screen.queryAllByRole('status')).toHaveLength(0)
  })
})

describe('views from a shared chunk', () => {
  it('a preloaded chunk renders at once, without its fallback', async () => {
    const source = chunk(async () => ({ Sidebar: () => <p>sidebar</p>, View: () => <p>view</p> }))
    await source.load()
    const Sidebar = lazyFrom(source, module => module.Sidebar)
    const View = lazyFrom(source, module => module.View)
    render(<Suspense fallback={<p>waiting</p>}><Sidebar /><View /></Suspense>)
    expect(screen.getByText('sidebar')).toBeInTheDocument()
    expect(screen.getByText('view')).toBeInTheDocument()
    expect(screen.queryByText('waiting')).toBeNull()
  })

  it('two boundaries on one chunk wait for the same request and reveal together', async () => {
    let calls = 0
    let release: () => void = () => undefined
    const source = chunk(() => { calls++; return new Promise<{ A: () => ReactElement; B: () => ReactElement }>(resolve => { release = () => resolve({ A: () => <p>a</p>, B: () => <p>b</p> }) }) })
    const A = lazyFrom(source, module => module.A)
    const B = lazyFrom(source, module => module.B)
    render(<><Suspense fallback={<p>wait a</p>}><A /></Suspense><Suspense fallback={<p>wait b</p>}><B /></Suspense></>)
    expect(screen.getByText('wait a')).toBeInTheDocument()
    expect(calls).toBe(1)
    await act(async () => { release(); await Promise.resolve() })
    expect(await screen.findByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })
})
