// @vitest-environment jsdom
// Frozen acceptance test for OXE-340 (program 152p1c, phase F1, Jira OXE-340). Written by the planner; the executor must not edit it.
// Contract: AnchoredMenu takes an optional point { x, y } in viewport pixels. With it, the hidden anchor is position
// fixed at that point; without it (Shift+F10, the ContextMenu key) the menu hangs from its element as before.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ConnectionList } from '../../../src/components/OxeQuery/ConnectionList'
import { OxeQueryView } from '../../../src/components/OxeQuery/OxeQueryView'
import { ResultGrid } from '../../../src/components/OxeQuery/ResultGrid'
import { SchemaTree } from '../../../src/components/OxeQuery/SchemaTree'
import { SqlWorkbench } from '../../../src/components/OxeQuery/SqlWorkbench'
import { loadOxeQueryCatalog } from '../../../src/components/OxeQuery/catalog'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import { changeLanguage } from '../../../src/i18n'
import { connection, installFakeOxeQuery } from '../../helpers/oxequery-api'

vi.mock('../../../src/components/OxeQuery/SqlEditor', () => ({ default: () => <div data-testid="mock-sql-editor" /> }))

const POINT = { clientX: 321, clientY: 123 }

/** The hidden anchor the open menu hangs from: Radix marks the trigger with the menu's id. */
async function anchor(): Promise<HTMLElement> {
  const menu = await screen.findByRole('menu')
  const found = document.querySelector<HTMLElement>(`[aria-controls="${menu.id}"]`)
  expect(found, 'the anchor of the open menu').not.toBeNull()
  return found!
}
async function opensAtPointer(target: HTMLElement): Promise<void> {
  fireEvent.contextMenu(target, POINT)
  const at = await anchor()
  expect({ position: at.style.position, left: at.style.left, top: at.style.top }).toEqual({ position: 'fixed', left: '321px', top: '123px' })
}

beforeEach(async () => {
  await loadOxeQueryCatalog()
  await changeLanguage('en')
  const api = installFakeOxeQuery()
  api.on('connections.list', [])
  api.on('workspace.load', { state: null })
  api.on('workspace.save', { ok: true })
  api.on('sql.tx', { state: 'none', statements: 0 })
  api.on('sql.schemas', ['public'])
  api.on('sql.tables', { tables: [{ schema: 'public', name: 'users', kind: 'table' }], total: 1 })
  api.on('sql.functions', [])
  api.on('sql.objects', { sequences: [], types: [], triggers: [], truncated: false })
  api.on('sql.extensions', [])
  api.on('audit.list', { entries: [], hasMore: false, cursor: null })
  const alpha = connection({ id: 'c-a', name: 'Alpha' })
  useOxeQueryStore.setState({
    connections: [alpha], connectionsError: null,
    tabs: [{ id: 'connection:c-a', kind: 'connection', title: 'Alpha', connectionId: 'c-a' }],
    activeTab: 'connection:c-a', dialog: { open: false, editing: null }, newDatabaseOpen: false, connectionSearch: '', foldedSections: []
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OXE-340 · OxeQuery menus and tree', () => {
  test('a connection menu opens at the pointer', async () => {
    await act(async () => { render(<ConnectionList activeTab="connection:c-a" />) })
    await opensAtPointer(screen.getByRole('button', { name: /^Alpha/ }))
  })

  test('a tab menu opens at the pointer', async () => {
    await act(async () => { render(<OxeQueryView active={false} />) })
    await opensAtPointer(screen.getByRole('tab', { name: 'Alpha' }))
  })

  test('a result cell menu opens at the pointer', async () => {
    render(<ResultGrid columns={['name']} types={['text']} rows={[['alice']]} onCopy={vi.fn()} onOpenCell={vi.fn()} onSort={vi.fn()} label="Result" />)
    await opensAtPointer(screen.getByRole('gridcell', { name: 'alice' }))
  })

  test('a result header menu opens at the pointer', async () => {
    render(<ResultGrid columns={['name']} types={['text']} rows={[['alice']]} onCopy={vi.fn()} onOpenCell={vi.fn()} onSort={vi.fn()} label="Result" />)
    await opensAtPointer(screen.getAllByRole('columnheader').find(el => el.textContent?.startsWith('name'))!)
  })

  test('a table row menu in the schema tree opens at the pointer', async () => {
    render(<SchemaTree connection={connection()} pinned={[]} onPinnedChange={vi.fn()} onOpen={vi.fn()} onInsert={vi.fn()} />)
    await opensAtPointer(await screen.findByRole('treeitem', { name: 'users' }))
  })

  test('the SQL editor menu opens at the pointer', async () => {
    render(<SqlWorkbench connection={connection()} />)
    await opensAtPointer((await screen.findByTestId('mock-sql-editor')).closest('.oq-editor') as HTMLElement)
  })

  test('a menu opened by the keyboard still hangs from its element', async () => {
    await act(async () => { render(<ConnectionList activeTab="connection:c-a" />) })
    fireEvent.keyDown(screen.getByRole('button', { name: /^Alpha/ }), { key: 'F10', shiftKey: true })
    expect((await anchor()).style.position).not.toBe('fixed')
  })

  // rigor: source-assertion — jsdom has no layout; the criterion is the stylesheet's reserved width.
  test('a table name keeps a readable width beside its actions', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/OxeQuery/OxeQuery.css'), 'utf8')
    const label = /\.oq-tree-label\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    const width = /min-width:\s*(\d+)ch/.exec(label)
    expect(width, '.oq-tree-label min-width in ch').not.toBeNull()
    expect(Number(width![1])).toBeGreaterThanOrEqual(5)
  })
})
