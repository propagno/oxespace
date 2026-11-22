import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityPanel } from '../../../src/components/OxeQuery/ActivityPanel'
import { ConnectionDialog } from '../../../src/components/OxeQuery/ConnectionDialog'
import { MongoWorkbench } from '../../../src/components/OxeQuery/MongoWorkbench'
import { OxeQueryView } from '../../../src/components/OxeQuery/OxeQueryView'
import { PreferencesDialog } from '../../../src/components/OxeQuery/PreferencesDialog'
import { SqlWorkbench } from '../../../src/components/OxeQuery/SqlWorkbench'
import { StructureEditor } from '../../../src/components/OxeQuery/StructureEditor'
import { TableEditor } from '../../../src/components/OxeQuery/TableEditor'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import { tokensCss } from '../../../src/design/tokens/css'
import field from '../../../src/ui/Field.module.css'
import { connection, installFakeOxeQuery, type FakeOxeQuery } from '../../helpers/oxequery-api'

vi.mock('@monaco-editor/react', () => ({
  default: ({ defaultValue, onChange }: { defaultValue?: string; onChange?: (value: string | undefined) => void }) =>
    <textarea aria-label="SQL editor" defaultValue={defaultValue} onChange={event => onChange?.(event.target.value)} />,
  loader: { config: () => undefined }
}))

vi.mock('../../../src/lib/monacoSetup', () => ({}))

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
const OQ_CSS = read('src/components/OxeQuery/OxeQuery.css')
const TOKENS = tokensCss()
const THEMES = ['light', 'dark'] as const
const DENSITIES = ['compact', 'comfortable'] as const

function tokenBlock(selector: string): Record<string, string> {
  const out: Record<string, string> = {}
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const match of TOKENS.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))) {
    for (const part of match[1].split(';')) {
      const colon = part.indexOf(':')
      if (colon > 0) out[part.slice(0, colon).trim()] = part.slice(colon + 1).trim()
    }
  }
  return out
}

const COMPACT_TOKENS = tokenBlock(':root')
const COMFORTABLE_TOKENS = { ...COMPACT_TOKENS, ...tokenBlock(":root[data-density='comfortable']") }
const MODE_TOKENS = {
  light: tokenBlock("[data-mode='light']"),
  dark: tokenBlock("[data-mode='dark']")
} as const

function setMatrix(mode: (typeof THEMES)[number], density: (typeof DENSITIES)[number]): void {
  document.documentElement.dataset.mode = mode
  document.documentElement.dataset.density = density
}

function cssRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...OQ_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  return matches.map(match => match[1]).join(';')
}

let api: FakeOxeQuery

beforeEach(() => {
  api = installFakeOxeQuery()
  const limit = { maxRows: 1000, statementTimeoutMs: 30_000 }
  api.on('audit.list', {
    entries: [
      { id: 'a1', ts: 1_700_000_000_000, actor: 'claude-code', actorLabel: 'Claude', tool: 'oxespace_query_run', connectionName: 'pg-dev', environment: 'dev', text: 'SELECT 1', decision: 'auto', outcome: 'ok', rows: 1, durationMs: 4 },
      { id: 'a2', ts: 1_700_000_005_000, actor: 'claude-code', actorLabel: 'Claude', tool: 'oxespace_query_execute', connectionName: 'pg-dev', environment: 'dev', text: 'DELETE FROM users', decision: 'denied', outcome: 'error', errorCode: 'policy', rows: null, durationMs: 1 }
    ],
    hasMore: false,
    cursor: null
  })
  api.on('preferences.get', {
    historyLimit: 200,
    auditRetentionDays: 90,
    agentCeiling: { local: 'write', dev: 'read', prod: 'read' },
    environmentLimits: { local: limit, dev: limit, prod: limit }
  })
  api.on('connections.list', [])
  api.on('workspace.load', { state: null })
  api.on('workspace.save', { ok: true })
  api.on('sql.tx', { state: 'none', statements: 0 })
  api.on('sql.schemas', ['public'])
  api.on('sql.tables', { tables: [{ schema: 'public', name: 'users', kind: 'table' }], total: 1 })
  api.on('sql.functions', [])
  api.on('sql.objects', { sequences: [], types: [], triggers: [], truncated: false })
  api.on('sql.extensions', [])
  api.on('sql.types', [])
  api.on('sql.table', { columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true, position: 1 }], indexes: [], foreignKeys: [], constraints: [], dependents: [], privileges: [], properties: null })
  api.on('sql.editability', {
    editable: true,
    columns: [
      { name: 'id', type: 'integer', nullable: false, hasDefault: true, generated: false, key: true },
      { name: 'email', type: 'text', nullable: true, hasDefault: false, generated: false, key: false }
    ]
  })
  api.on('sql.script', {
    statements: [
      { index: 0, sql: 'SELECT 1', start: 0, end: 8, result: { columns: [{ name: 'one', type: 'int4' }], rows: [[1]], rowCount: 1, truncated: false, durationMs: 2 } },
      { index: 1, sql: 'SELECT 2', start: 10, end: 18, result: { columns: [{ name: 'two', type: 'int4' }], rows: [[2]], rowCount: 1, truncated: false, durationMs: 3 } }
    ]
  })
  api.on('library.list', { saved: [], history: [] })
  api.on('mongo.databases', [{ name: 'shop' }])
  api.on('mongo.collections', [{ name: 'items', type: 'collection' }])
  api.on('mongo.find', { documents: ['{"_id":1,"sku":"a"}'], truncated: true, durationMs: 2, total: 10 })
  api.on('mongo.indexes', [])
  api.on('mongo.validation', { validator: null, level: 'strict', action: 'error' })
  api.on('mongo.stats', { documents: 10, sizeBytes: 1000, avgDocumentBytes: 100, storageBytes: 2048, indexes: 1, indexBytes: 512, capped: false })
  useOxeQueryStore.setState({ connections: [], tabs: [], activeTab: '', dialog: { open: false, editing: null }, newDatabaseOpen: false })
})

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.mode
  delete document.documentElement.dataset.density
})

describe('OXE-161 · OxeQuery internal anatomy on 1.5.2 scale', () => {
  it('renders OxeQuery ActivityPanel on 1.5.2 token scale with zero raw buttons across themes and densities', async () => {
    const source = read('src/components/OxeQuery/ActivityPanel.tsx')
    expect(source.match(/<button\b/g) ?? []).toHaveLength(0)

    const headRule = cssRuleBody('.oq-activity-head')
    const rowRule = cssRuleBody('.oq-activity-table tbody tr')
    const cellRule = cssRuleBody('.oq-activity-table th, .oq-activity-table td')
    const hoverRule = cssRuleBody('.oq-activity-table tbody tr:hover')
    expect(headRule).toContain('min-height: var(--bar-lg)')
    expect(rowRule).toContain('height: var(--row-1)')
    expect(cellRule).toContain('var(--bd-subtle)')
    expect(hoverRule).toContain('var(--fill-hover)')
    expect(hoverRule).not.toMatch(/rgba\(/i)

    for (const mode of THEMES) {
      expect(MODE_TOKENS[mode]['--bd-subtle']).toBeTruthy()
      expect(MODE_TOKENS[mode]['--fill-hover']).toBeTruthy()
      for (const density of DENSITIES) {
        setMatrix(mode, density)
        const scale = density === 'compact' ? COMPACT_TOKENS : COMFORTABLE_TOKENS
        expect(scale['--bar-lg']).toBe(density === 'compact' ? '36px' : '40px')
        expect(scale['--row-1']).toBe(density === 'compact' ? '28px' : '32px')

        const { container } = render(<ActivityPanel active />)
        await screen.findByText('SELECT 1')

        const filterGroup = screen.getByRole('radiogroup', { name: 'Filter' })
        expect(filterGroup.classList.contains(field.segmented)).toBe(true)
        const radios = within(filterGroup).getAllByRole('radio')
        expect(radios).toHaveLength(3)
        expect(radios.every(radio => radio.classList.contains(field.segment))).toBe(true)

        const refresh = screen.getByRole('button', { name: 'Refresh' })
        expect(refresh).toHaveAttribute('data-ui', 'button')

        const nonPrimitiveButtons = [...container.querySelectorAll('button')].filter(
          button => !button.hasAttribute('data-ui') && !button.classList.contains(field.segment)
        )
        expect(nonPrimitiveButtons).toEqual([])

        fireEvent.click(within(filterGroup).getByRole('radio', { name: 'Problems' }))
        expect(screen.queryByText('SELECT 1')).toBeNull()
        expect(screen.getByText('DELETE FROM users')).toBeInTheDocument()

        cleanup()
      }
    }
  })

  it('uses Dialog, SettingRow and Button primitives across Connection, NewTable and Preferences dialogs', async () => {
    const tableEditorSource = read('src/components/OxeQuery/TableEditor.tsx')
    expect(tableEditorSource.match(/<button\b/g) ?? []).toHaveLength(0)

    const sampleResult = {
      columns: [{ name: 'id', type: 'int4' }, { name: 'email', type: 'text' }],
      rows: [[1, 'alice@example.com']],
      rowCount: 1,
      truncated: false,
      durationMs: 2
    }

    for (const mode of THEMES) {
      for (const density of DENSITIES) {
        setMatrix(mode, density)

        render(<PreferencesDialog onClose={() => undefined} />)
        const prefsDialog = await screen.findByRole('dialog', { name: 'OxeQuery settings' })
        await within(prefsDialog).findAllByRole('combobox')
        expect(prefsDialog.querySelectorAll('[data-ui="setting-row"]').length).toBeGreaterThanOrEqual(5)
        expect(within(prefsDialog).getByRole('button', { name: 'Save' })).toHaveAttribute('data-ui', 'button')
        expect(within(prefsDialog).getByRole('button', { name: 'Cancel' })).toHaveAttribute('data-ui', 'button')
        cleanup()

        render(<StructureEditor connection={connection()} schema="public" table={null} onClose={() => undefined} onChanged={() => undefined} />)
        const newTableDialog = await screen.findByRole('dialog', { name: 'New table in public' })
        expect(within(newTableDialog).getByRole('tablist')).toHaveAttribute('data-ui', 'tabs')
        expect(within(newTableDialog).getByRole('button', { name: 'Review SQL' })).toHaveAttribute('data-ui', 'button')
        cleanup()

        useOxeQueryStore.setState({ dialog: { open: true, editing: null } })
        render(<ConnectionDialog />)
        const connDialog = await screen.findByRole('dialog', { name: 'New connection' })
        expect(within(connDialog).getByRole('button', { name: 'Save and open' })).toHaveAttribute('data-ui', 'button')
        expect(within(connDialog).getByRole('button', { name: 'Cancel' })).toHaveAttribute('data-ui', 'button')
        cleanup()

        const { container } = render(
          <TableEditor connection={connection()} schema="public" table="users" result={sampleResult} selectedRow={0} onClearSelection={() => undefined} onApplied={() => undefined} />
        )
        const editBtn = await screen.findByRole('button', { name: 'Edit rows' })
        expect(editBtn).toHaveAttribute('data-ui', 'button')
        fireEvent.click(editBtn)
        expect(await screen.findByRole('button', { name: 'Stage delete' })).toHaveAttribute('data-variant', 'danger')
        const rawEditorButtons = [...container.querySelectorAll('button')].filter(button => !button.hasAttribute('data-ui'))
        expect(rawEditorButtons).toEqual([])
        cleanup()
      }
    }
  })

  it('renders SQL and Mongo workbenches with Tabs primitive and token heights across themes and densities', async () => {
    expect(cssRuleBody('.oq-tabs-bar')).toContain('min-height: var(--bar-lg)')
    expect(cssRuleBody('.oq-tabs-bar')).not.toContain('36px')
    expect(cssRuleBody('.oq-tabs')).toContain('min-height: var(--bar-md)')
    expect(cssRuleBody('.oq-qtabs')).toContain('min-height: var(--bar-md)')
    expect(cssRuleBody('.oq-editor-toolbar')).toContain('min-height: var(--bar-lg)')
    expect(cssRuleBody('.oq-results')).toContain('background: var(--surface-base)')
    expect(cssRuleBody('.oq-results > .oq-results-bar')).toContain('min-height: var(--bar-md)')

    const pg = connection({ id: 'pg-1', name: 'pg-dev', engine: 'postgres' })
    const mongo = connection({ id: 'mg-1', name: 'mongo-dev', engine: 'mongodb' })

    for (const mode of THEMES) {
      expect(MODE_TOKENS[mode]['--surface-base']).toBeTruthy()
      expect(MODE_TOKENS[mode]['--bd-subtle']).toBeTruthy()
      for (const density of DENSITIES) {
        setMatrix(mode, density)
        const scale = density === 'compact' ? COMPACT_TOKENS : COMFORTABLE_TOKENS
        expect(scale['--bar-md']).toBe(density === 'compact' ? '32px' : '36px')
        expect(scale['--bar-lg']).toBe(density === 'compact' ? '36px' : '40px')

        api.on('connections.list', [pg])
        useOxeQueryStore.setState({
          connections: [pg],
          tabs: [{ id: 'tab-pg', kind: 'connection', connectionId: pg.id, title: pg.name }],
          activeTab: 'tab-pg'
        })
        render(<OxeQueryView active />)
        await screen.findByLabelText('SQL editor')
        expect(screen.getByRole('button', { name: 'Close pg-dev' })).toHaveAttribute('data-ui', 'icon-button')
        expect(screen.getByRole('button', { name: 'New query' })).toHaveAttribute('data-ui', 'icon-button')
        cleanup()

        render(<SqlWorkbench connection={pg} />)
        const editor = await screen.findByLabelText('SQL editor')
        await waitFor(() => expect(api.callsOf('workspace.load').length).toBeGreaterThan(0))
        fireEvent.change(editor, { target: { value: 'SELECT 1; SELECT 2;' } })
        fireEvent.click(screen.getByRole('button', { name: 'Run all' }))
        const outputTabs = await screen.findByRole('tablist', { name: 'Results' })
        expect(outputTabs).toHaveAttribute('data-ui', 'tabs')
        expect(within(outputTabs).getAllByRole('tab')).toHaveLength(2)
        cleanup()

        render(<MongoWorkbench connection={mongo} />)
        fireEvent.click(await screen.findByRole('button', { name: 'shop' }))
        fireEvent.click(await screen.findByRole('button', { name: 'items' }))
        await screen.findByText(/_id: 1/)

        expect(screen.getByRole('button', { name: 'Find' })).toHaveAttribute('data-ui', 'button')
        expect(screen.getByRole('button', { name: 'Aggregate' })).toHaveAttribute('data-ui', 'button')
        const resultView = screen.getByRole('radiogroup', { name: 'Result view' })
        expect(resultView.classList.contains(field.segmented)).toBe(true)
        expect(within(resultView).getAllByRole('radio')).toHaveLength(3)
        expect(screen.getByRole('button', { name: 'Previous' })).toHaveAttribute('data-ui', 'button')
        expect(screen.getByRole('button', { name: 'Next' })).toHaveAttribute('data-ui', 'button')
        expect(screen.getByRole('button', { name: 'Copy JSON' })).toHaveAttribute('data-ui', 'button')
        expect(screen.getByRole('button', { name: 'New document' })).toHaveAttribute('data-ui', 'button')
        expect(screen.getByRole('button', { name: 'Change many…' })).toHaveAttribute('data-ui', 'button')
        expect(screen.getByRole('button', { name: 'Refresh databases' })).toHaveAttribute('data-ui', 'icon-button')
        cleanup()
      }
    }
  })
})
