import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Suspense, type ReactElement } from 'react'
import { SidebarSkeleton } from '../src/ui'
import { chunk, lazyFrom } from '../src/lib/chunk'

// The Settings chunk stays pending until a test lets it through, so the shell is what the first click shows.
const gate = vi.hoisted(() => { let open: () => void = () => undefined; const ready = new Promise<void>(resolve => { open = resolve }); return { ready, open: () => open() } })
vi.mock('../src/components/Settings/SettingsCenter', async () => {
  await gate.ready
  return { SettingsCenter: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="Real settings"><button onClick={onClose}>Back to work</button></div> }
})
const { SettingsCenter } = await import('../src/components/Settings/SettingsHost')

afterEach(() => cleanup())

describe('view sidebar skeleton', () => {
  it('is a busy region with the header and one polite loading label', () => {
    render(<SidebarSkeleton label="OxePod sidebar" title="OxePod" />)
    const region = screen.getByRole('complementary', { name: 'OxePod sidebar' })
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(region).toHaveClass('thread-navigation')
    expect(region).toHaveTextContent('OxePod')
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument()
    expect(region.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3)
  })

  it('collapsed to the rail it keeps the announcement without the header', () => {
    render(<SidebarSkeleton label="Thread sidebar" title="Conversations" collapsed />)
    const region = screen.getByRole('complementary', { name: 'Thread sidebar' })
    expect(region).toHaveClass('thread-navigation-collapsed')
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument()
    expect(region).not.toHaveTextContent('Conversations')
  })
})

describe('Settings opening', () => {
  it('shows the shell at once (title, close, loading), then the real Settings in its place', async () => {
    const onClose = vi.fn()
    const props = { onClose } as unknown as Parameters<typeof SettingsCenter>[0]
    render(<SettingsCenter {...props} />)
    const shell = screen.getByRole('dialog', { name: 'Settings' })
    expect(shell).toHaveAttribute('aria-busy', 'true')
    expect(shell).toHaveClass('settings-center')
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(onClose).toHaveBeenCalledOnce()

    await act(async () => { gate.open(); await gate.ready; await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(await screen.findByRole('dialog', { name: 'Real settings' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
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
