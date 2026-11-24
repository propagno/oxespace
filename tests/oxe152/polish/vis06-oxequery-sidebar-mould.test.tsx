import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OxeQuerySidebar } from '../../../src/components/OxeQuery/OxeQuerySidebar'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import { changeLanguage } from '../../../src/i18n'
import { useUIStore } from '../../../src/store/ui.store'
import { connection, installFakeOxeQuery } from '../../helpers/oxequery-api'

const THEMES = ['light', 'dark'] as const
const DENSITIES = ['compact', 'comfortable'] as const

const CONNECTIONS = [
  connection({ id: 'c1', name: 'pg-dev', engine: 'postgres', environment: 'dev', group: 'Core', favorite: true }),
  connection({ id: 'c2', name: 'pg-prod', engine: 'postgres', environment: 'prod', group: 'Core' }),
  connection({ id: 'c3', name: 'mongo-local', engine: 'mongodb', environment: 'local', group: 'Analytics' }),
  connection({ id: 'c4', name: 'pg-stage', engine: 'postgres', environment: 'dev', group: 'Analytics' }),
  connection({ id: 'c5', name: 'pg-extra', engine: 'postgres', environment: 'local', group: 'Analytics' })
]

beforeEach(() => {
  const api = installFakeOxeQuery()
  api.on('connections.list', () => CONNECTIONS)
  useUIStore.setState({ oxequerySidebarCollapsed: false })
  useOxeQueryStore.setState({
    connections: CONNECTIONS,
    tabs: [{ id: 'connection:c1', kind: 'connection', connectionId: 'c1', title: 'pg-dev' }],
    activeTab: 'connection:c1',
    connectionSearch: '',
    foldedSections: [],
    preferencesOpen: false,
    newDatabaseOpen: false
  })
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  useUIStore.setState({ oxequerySidebarCollapsed: false })
  await changeLanguage('en')
})

describe('OXE-28 · VIS-06 OxeQuery sidebar aligns to src/ui/Sidebar mould', () => {
  test('renders OxeQuery sidebar with Sidebar primitives (--bar-lg, --row-1) and zero raw buttons across light/dark themes and compact/comfortable densities', async () => {
    const sidebarModuleCss = readFileSync(resolve(process.cwd(), 'src/ui/Sidebar.module.css'), 'utf8')
    const oxeQueryCss = readFileSync(resolve(process.cwd(), 'src/components/OxeQuery/OxeQuery.css'), 'utf8')
    expect(sidebarModuleCss).toMatch(/\.header\s*\{[^}]*height:\s*var\(--bar-lg\)/)
    expect(sidebarModuleCss).toMatch(/\.footer\s*\{[^}]*height:\s*var\(--bar-lg\)/)
    expect(sidebarModuleCss).toMatch(/\.row\s*\{[^}]*min-height:\s*var\(--row-1\)/)
    expect(sidebarModuleCss).toMatch(/\.section\s*\{[^}]*height:\s*var\(--bar-sm\)/)
    expect(oxeQueryCss).toMatch(/\.oq-conn-heading\s*\{[^}]*min-height:\s*var\(--bar-sm\)/)

    for (const theme of THEMES) {
      for (const density of DENSITIES) {
        document.documentElement.setAttribute('data-theme', theme)
        document.documentElement.setAttribute('data-density', density)

        const view = render(<OxeQuerySidebar />)
        await act(async () => { await Promise.resolve() })

        const aside = document.querySelector<HTMLElement>('aside.oq-sidebar')
        expect(aside).not.toBeNull()

        // E2E readiness contract (e2e/perceived-perf.spec.ts:275): aside.oq-sidebar .oq-sidebar-content header
        const header = aside!.querySelector('.oq-sidebar-content header')
        expect(header, `${theme}/${density} preserves .oq-sidebar-content header`).not.toBeNull()
        expect(header!.querySelector('[data-ui="sidebar-header"]')).not.toBeNull()

        // Footer uses SidebarFooter primitive (--bar-lg)
        expect(aside!.querySelector('[data-ui="sidebar-footer"]')).not.toBeNull()

        // Connections section uses SidebarSection (--bar-sm 24 px) and SidebarFilter
        const region = within(aside!).getByRole('region', { name: 'Connections' })
        expect(region.querySelector('[data-ui="sidebar-section"]')).not.toBeNull()
        expect(region.querySelector('[data-ui="sidebar-filter"]')).not.toBeNull()

        // Connection groups use SidebarGroup
        const groups = [...region.querySelectorAll<HTMLElement>('[data-ui="sidebar-group"]')]
        expect(groups.length, `${theme}/${density} renders SidebarGroup headings`).toBeGreaterThanOrEqual(2)

        // Connection rows and Agent activity use SidebarRow (--row-1)
        const rows = [...aside!.querySelectorAll<HTMLElement>('[data-ui="sidebar-row"]')]
        expect(rows.length).toBeGreaterThanOrEqual(CONNECTIONS.length + 1)

        // Zero raw <button> elements (every <button> inside the expanded sidebar carries data-ui)
        const rawButtons = [...aside!.querySelectorAll<HTMLButtonElement>('button')].filter(btn => !btn.hasAttribute('data-ui'))
        expect(rawButtons, `${theme}/${density} should have zero raw <button> elements`).toEqual([])

        // CA-2 / RT-3 accessible selectors & hooks preserved
        expect(aside!.querySelector('[data-oq-action="settings"]')).not.toBeNull()
        expect(screen.getByTestId('oq-active-connection')).toBeInTheDocument()
        expect(within(region).getAllByRole('button', { name: /^pg-dev/ }).length).toBeGreaterThanOrEqual(1)
        expect(within(aside!).getAllByRole('button', { name: 'Edit pg-dev' }).length).toBeGreaterThanOrEqual(1)
        expect(within(aside!).getByRole('button', { name: 'Agent activity' })).toBeInTheDocument()

        view.unmount()
      }
    }
  })

  test('preserves interactions for Agent activity, Edit connection, settings, group collapse, and collapsed NavigationRail', async () => {
    const openDialog = vi.spyOn(useOxeQueryStore.getState(), 'openDialog')
    const openActivity = vi.spyOn(useOxeQueryStore.getState(), 'openActivity')
    const setPreferencesOpen = vi.spyOn(useOxeQueryStore.getState(), 'setPreferencesOpen')

    render(<OxeQuerySidebar />)
    await act(async () => { await Promise.resolve() })

    const aside = document.querySelector<HTMLElement>('aside.oq-sidebar')!
    fireEvent.click(within(aside).getAllByRole('button', { name: 'Edit pg-dev' })[0])
    expect(openDialog).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', name: 'pg-dev' }))

    fireEvent.click(within(aside).getByRole('button', { name: 'Agent activity' }))
    expect(openActivity).toHaveBeenCalledTimes(1)

    fireEvent.click(aside.querySelector<HTMLElement>('[data-oq-action="settings"]')!)
    expect(setPreferencesOpen).toHaveBeenCalledWith(true)

    // Collapsed sidebar renders NavigationRail with connection items
    act(() => { useUIStore.setState({ oxequerySidebarCollapsed: true }) })
    expect(aside.classList.contains('thread-navigation-collapsed')).toBe(true)
    expect(aside.querySelector('.oq-sidebar-content')).toBeNull()
    expect(within(aside).getByRole('button', { name: 'pg-dev' })).toBeInTheDocument()
  })
})
