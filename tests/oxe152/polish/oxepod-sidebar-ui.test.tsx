import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ContainerSummary, OxePodEvent } from '../../../shared/types/oxepod'
import { installFakeOxeQuery, type FakeOxeQuery } from '../../helpers/oxequery-api'
import { OxePodSidebar } from '../../../src/components/OxePod/OxePodSidebar'
import { useOxePodStore } from '../../../src/components/OxePod/oxepod.store'

// OXE-311: the OxePod sidebar still drew its own <header>, a <label className="desktop-search"> filter and raw <button>
// rows; it now uses the src/ui sidebar anatomy (SidebarHeader, SidebarFilter, SidebarRow), like OxeCode and OxeChat.

const container = (change: Partial<ContainerSummary>): ContainerSummary => ({
  id: 'a'.repeat(64), name: 'web', image: 'nginx:1', state: 'running', status: 'Up 2 hours', ports: [{ hostPort: 8080, containerPort: 80, protocol: 'tcp' }], labels: {}, ...change
})
const web = container({})
const postgres = container({ id: 'b'.repeat(64), name: 'pg-dev', image: 'postgres:16', ports: [{ hostPort: 5432, containerPort: 5432, protocol: 'tcp' }], labels: { 'com.docker.compose.project': 'shop' } })
const DOCKER = { engine: 'docker' as const, available: true, state: 'ready' as const, version: '27.0', context: 'default' }

let api: FakeOxeQuery
beforeEach(() => {
  api = installFakeOxeQuery()
  const oxe = (window as unknown as { oxe: { oxePod: { onEvent: (listener: (event: OxePodEvent) => void) => () => void } } }).oxe
  oxe.oxePod.onEvent = () => () => undefined
  api.on('containers.list', { containers: [web, postgres], engine: 'docker' })
  api.on('containers.engines', [DOCKER, { engine: 'podman', available: false, state: 'missing' }])
  api.on('containers.candidates', [])
  api.on('containers.stats', [])
  useOxePodStore.setState({ containers: [web, postgres], error: null, loading: false, engine: 'docker', selected: postgres.id, view: 'container', filter: '', pendingPrune: null, engines: [DOCKER] })
})
afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.mode
  delete document.documentElement.dataset.density
})

describe('OXE-311 · OxePod sidebar on the src/ui sidebar primitives', () => {
  for (const mode of ['light', 'dark'] as const) for (const density of ['compact', 'comfortable'] as const) {
    test(`OxePodSidebar renders SidebarHeader, SidebarFilter and SidebarRow primitives across themes and densities (${mode}, ${density})`, async () => {
      document.documentElement.dataset.mode = mode
      document.documentElement.dataset.density = density
      const { container: root } = render(<OxePodSidebar />)
      const shop = await screen.findByRole('region', { name: 'Project shop' })

      const header = root.querySelector('[data-ui="sidebar-header"]')
      expect(header).not.toBeNull()
      expect(header).toHaveTextContent('OxePod')

      const filter = screen.getByRole('searchbox', { name: 'Filter containers' })
      expect(filter.closest('[data-ui="sidebar-filter"]')).not.toBeNull()
      expect(filter).toHaveAttribute('placeholder', 'Filter…')

      const rows = root.querySelectorAll('[data-ui="sidebar-row"]')
      // web, pg-dev, and the two links (images/volumes/networks, agent activity).
      expect(rows).toHaveLength(4)
      const selected = within(shop).getByRole('button', { name: /pg-dev/ })
      expect(selected).toHaveAttribute('data-ui', 'sidebar-row')
      expect(selected).toHaveAttribute('aria-current', 'page')
      expect(root.querySelectorAll('[data-ui="sidebar-row"][aria-current="page"]')).toHaveLength(1)
    })
  }

  test('the filter keeps its behaviour: typing narrows, Escape clears', async () => {
    render(<OxePodSidebar />)
    const filter = await screen.findByRole('searchbox', { name: 'Filter containers' })
    fireEvent.change(filter, { target: { value: 'nginx' } })
    expect(useOxePodStore.getState().filter).toBe('nginx')
    fireEvent.keyDown(filter, { key: 'Escape' })
    expect(useOxePodStore.getState().filter).toBe('')
  })

  test('[source] OxePodSidebar.tsx has no raw <button>, <header> or desktop-search label', () => {
    const tsx = readFileSync(resolve(process.cwd(), 'src/components/OxePod/OxePodSidebar.tsx'), 'utf8')
    expect(tsx).not.toMatch(/<button\b/)
    expect(tsx).not.toMatch(/<header\b/)
    expect(tsx).not.toMatch(/desktop-search/)
    expect(tsx).toMatch(/<SidebarHeader\b/)
    expect(tsx).toMatch(/<SidebarFilter\b/)
    expect(tsx).toMatch(/<SidebarRow\b/)
  })
})
