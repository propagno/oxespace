import { act, cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { OxeQuerySidebar } from '../../../src/components/OxeQuery/OxeQuerySidebar'
import { OxeQueryView } from '../../../src/components/OxeQuery/OxeQueryView'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import { useUIStore } from '../../../src/store/ui.store'
import { connection, installFakeOxeQuery } from '../../helpers/oxequery-api'

vi.mock('../../../src/components/OxeQuery/SqlWorkbench', () => ({
  SqlWorkbench: () => <div data-testid="mock-sql-workbench" />
}))
vi.mock('../../../src/components/OxeQuery/MongoWorkbench', () => ({
  MongoWorkbench: () => <div data-testid="mock-mongo-workbench" />
}))
vi.mock('../../../src/components/OxeQuery/ActivityPanel', () => ({
  ActivityPanel: () => <div data-testid="mock-activity-panel" />
}))
vi.mock('../../../src/components/OxeQuery/ConnectionDialog', () => ({
  ConnectionDialog: () => null
}))

const THEMES = ['light', 'dark'] as const
const DENSITIES = ['compact', 'comfortable'] as const
const ENVIRONMENTS = ['local', 'dev', 'prod'] as const

const oxeQueryCss = (): string => readFileSync(resolve(process.cwd(), 'src/components/OxeQuery/OxeQuery.css'), 'utf8')

beforeEach(() => {
  const api = installFakeOxeQuery()
  api.on('connections.list', () => [])
  useUIStore.setState({ oxequerySidebarCollapsed: false })
  useOxeQueryStore.setState({
    connections: [],
    tabs: [],
    activeTab: '',
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

describe('OXE-45 · VIS-21 OxeQuery single environment badge and --font-ui meta label', () => {
  test('renders the active connection environment badge once without repeating local across sidebar and view', async () => {
    for (const env of ENVIRONMENTS) {
      const conn = connection({ id: `conn-${env}`, name: `db-${env}`, environment: env, agentAccess: 'off' })
      const api = installFakeOxeQuery()
      api.on('connections.list', () => [conn])
      const tabId = `connection:${conn.id}`

      for (const theme of THEMES) {
        for (const density of DENSITIES) {
          document.documentElement.setAttribute('data-theme', theme)
          document.documentElement.setAttribute('data-density', density)
          useUIStore.setState({ oxequerySidebarCollapsed: false })
          useOxeQueryStore.setState({
            connections: [conn],
            tabs: [{ id: tabId, kind: 'connection', connectionId: conn.id, title: conn.name }],
            activeTab: tabId
          })

          const view = render(
            <div>
              <OxeQuerySidebar />
              <OxeQueryView active />
            </div>
          )
          await act(async () => { await Promise.resolve() })

          // Exactly 1 .oq-env-pill on the entire screen: inside OxeQueryView's .oq-view-meta, never duplicated in sidebar
          const pills = [...document.querySelectorAll<HTMLElement>('.oq-env-pill')]
          expect(pills, `${env}/${theme}/${density} should render exactly one .oq-env-pill`).toHaveLength(1)
          expect(pills[0].closest('.oq-view-meta')).not.toBeNull()
          expect(pills[0]).toHaveAttribute('data-env', env)

          const activeCard = screen.getByTestId('oq-active-connection')
          expect(activeCard.querySelectorAll('.oq-env-pill')).toHaveLength(0)
          const dot = activeCard.querySelector<HTMLElement>('.oq-status-dot')
          expect(dot).not.toBeNull()
          expect(dot).toHaveAttribute('data-env', env)

          // Collapsing the sidebar keeps the single .oq-env-pill visible in OxeQueryView
          act(() => { useUIStore.setState({ oxequerySidebarCollapsed: true }) })
          expect(document.querySelectorAll('.oq-env-pill')).toHaveLength(1)

          view.unmount()
        }
      }
    }

    // Prod danger tokens and base pill tokens stay intact
    const css = oxeQueryCss()
    expect(css).toMatch(/\.oq-env-pill\s*\{[^}]*font-family:\s*var\(--font-ui\)[^}]*font-size:\s*var\(--fs-2xs\)/)
    expect(css).toMatch(/\.oq-env-pill\[data-env='prod'\]\s*\{[^}]*--intent-danger-border[^}]*--intent-danger-bg[^}]*--intent-danger-fg/)
  })

  test('renders Agents access hint in --font-ui rather than monospace', async () => {
    const conn = connection({ id: 'conn-local', name: 'local-db', environment: 'local', agentAccess: 'off' })
    const api = installFakeOxeQuery()
    api.on('connections.list', () => [conn])
    const tabId = `connection:${conn.id}`

    for (const lang of ['en', 'pt-BR'] as const) {
      await changeLanguage(lang)
      for (const theme of THEMES) {
        for (const density of DENSITIES) {
          document.documentElement.setAttribute('data-theme', theme)
          document.documentElement.setAttribute('data-density', density)
          useOxeQueryStore.setState({
            connections: [conn],
            tabs: [{ id: tabId, kind: 'connection', connectionId: conn.id, title: conn.name }],
            activeTab: tabId
          })

          const view = render(<OxeQueryView active />)
          await act(async () => { await Promise.resolve() })

          const meta = document.querySelector<HTMLElement>('.oq-view-meta')
          expect(meta).not.toBeNull()
          const expectedHint = i18n.t('form.agentsHint.off', { ns: 'oxequery' })
          expect(meta!.textContent).toContain(expectedHint)
          view.unmount()
        }
      }
    }

    const css = oxeQueryCss()
    const viewMetaRule = css.match(/\.oq-view-meta\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(viewMetaRule).toMatch(/font-family:\s*var\(--font-ui\)/)
    expect(viewMetaRule).not.toMatch(/--font-mono/)

    // Technical identifiers keep --font-mono
    expect(css).toMatch(/\.oq-engine-tag\s*\{[^}]*font-family:\s*var\(--font-mono\)/)
    expect(css).toMatch(/\.oq-active-conn-sub\s*\{[^}]*font-family:\s*var\(--font-mono\)/)
  })
})
