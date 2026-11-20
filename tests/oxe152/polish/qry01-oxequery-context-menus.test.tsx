// @vitest-environment jsdom
// Acceptance test for 1.5.3 QRY-1 (Jira OXE-44): OxeQuery right-click and Shift+F10 context menus across connections, tabs, schema tree, result grid and SQL editor.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ConnectionList } from '../../../src/components/OxeQuery/ConnectionList'
import { OxeQueryView } from '../../../src/components/OxeQuery/OxeQueryView'
import { ResultGrid } from '../../../src/components/OxeQuery/ResultGrid'
import { SchemaTree } from '../../../src/components/OxeQuery/SchemaTree'
import { SqlWorkbench } from '../../../src/components/OxeQuery/SqlWorkbench'
import { loadOxeQueryCatalog } from '../../../src/components/OxeQuery/catalog'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import { changeLanguage } from '../../../src/i18n'
import { connection, installFakeOxeQuery, type FakeOxeQuery } from '../../helpers/oxequery-api'

const monacoOptionsSpy = vi.fn()
const mockFormatRun = vi.fn(async () => undefined)
const mockTrigger = vi.fn()
const mockExecuteEdits = vi.fn()
let mockSelectionText = 'SELECT 42;'

vi.mock('../../../src/components/OxeQuery/SqlEditor', () => ({
  default: function MockSqlEditor({ defaultValue, options, onMount }: {
    defaultValue?: string
    options?: Record<string, unknown>
    onMount?: (editor: unknown, monaco: unknown) => void
  }) {
    monacoOptionsSpy(options)
    useEffect(() => {
      if (!onMount) return
      const mockEditor = {
        getValue: () => defaultValue ?? '',
        setValue: vi.fn(),
        focus: vi.fn(),
        getModel: () => ({
          getValue: () => defaultValue ?? '',
          getValueInRange: () => mockSelectionText,
          getOffsetAt: () => 0,
          getPositionAt: () => ({ lineNumber: 1, column: 1 }),
          getWordAtPosition: () => null
        }),
        getSelection: () => (mockSelectionText ? { isEmpty: () => false, getStartPosition: () => ({ lineNumber: 1, column: 1 }) } : { isEmpty: () => true, getStartPosition: () => ({ lineNumber: 1, column: 1 }) }),
        getPosition: () => ({ lineNumber: 1, column: 1 }),
        getAction: (id: string) => id === 'editor.action.formatDocument' ? { run: mockFormatRun } : null,
        trigger: mockTrigger,
        executeEdits: mockExecuteEdits,
        onDidFocusEditorText: vi.fn(() => ({ dispose: vi.fn() })),
        onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
        addCommand: vi.fn()
      }
      const mockMonaco = {
        KeyMod: { CtrlCmd: 2048, Shift: 1024 },
        KeyCode: { Enter: 3 },
        MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
        editor: { setModelMarkers: vi.fn() },
        languages: { registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })), registerDocumentFormattingEditProvider: vi.fn(() => ({ dispose: vi.fn() })) }
      }
      onMount(mockEditor, mockMonaco)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return <div data-testid="mock-sql-editor">{defaultValue}</div>
  }
}))

let api: FakeOxeQuery

beforeEach(async () => {
  await loadOxeQueryCatalog()
  await changeLanguage('pt-BR')
  monacoOptionsSpy.mockReset()
  mockFormatRun.mockReset()
  mockTrigger.mockReset()
  mockExecuteEdits.mockReset()
  mockSelectionText = 'SELECT 42;'
  api = installFakeOxeQuery()
  api.on('connections.list', [])
  api.on('connections.delete', { ok: true })
  api.on('connections.duplicate', connection({ id: 'dup', name: 'Shop (copy)' }))
  api.on('workspace.load', { state: null })
  api.on('workspace.save', { ok: true })
  api.on('sql.tx', { state: 'none', statements: 0 })
  api.on('sql.schemas', ['public'])
  api.on('sql.tables', { tables: [{ schema: 'public', name: 'users', kind: 'table' }], total: 1 })
  api.on('sql.functions', [{ name: 'sum_total', kind: 'function', oid: 10 }])
  api.on('sql.objects', { sequences: [], types: [], triggers: [], truncated: false })
  api.on('sql.extensions', [])
  api.on('sql.definition', { text: 'CREATE FUNCTION sum_total() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;' })
  api.on('sql.run', { columns: [{ name: 'ok', type: 'int4' }], rows: [[42]], rowCount: 1, durationMs: 1, truncated: false })
  api.on('audit.list', { entries: [], hasMore: false, cursor: null })
  Object.assign(window.oxe, {
    clipboard: { writeText: vi.fn(async () => true) }
  })
  useOxeQueryStore.setState({
    connections: [],
    connectionsError: null,
    tabs: [],
    activeTab: '',
    dialog: { open: false, editing: null },
    newDatabaseOpen: false,
    connectionSearch: '',
    foldedSections: []
  })
})

afterEach(async () => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-44 · QRY-1 OxeQuery context menus', () => {
  test('opens accessible context menus on connections and tabs with keyboard navigation across themes and densities', async () => {
    const connA = connection({ id: 'c-a', name: 'Alpha' })
    const connB = connection({ id: 'c-b', name: 'Beta' })
    const connC = connection({ id: 'c-c', name: 'Gamma' })

    for (const theme of ['light', 'dark'] as const) {
      for (const density of ['compact', 'comfortable'] as const) {
        document.documentElement.setAttribute('data-theme', theme)
        document.documentElement.setAttribute('data-density', density)

        useOxeQueryStore.setState({
          connections: [connA, connB, connC],
          tabs: [
            { id: 'connection:c-a', kind: 'connection', title: 'Alpha', connectionId: 'c-a' },
            { id: 'connection:c-b', kind: 'connection', title: 'Beta', connectionId: 'c-b' },
            { id: 'connection:c-c', kind: 'connection', title: 'Gamma', connectionId: 'c-c' }
          ],
          activeTab: 'connection:c-a'
        })

        // 1) ConnectionList context menu (right-click & Shift+F10, Escape closes, Delete opens ConfirmDialog)
        const connView = render(<ConnectionList activeTab="connection:c-a" />)
        const alphaBtn = screen.getByRole('button', { name: /^Alpha/ })
        fireEvent.keyDown(alphaBtn, { key: 'F10', shiftKey: true })

        const connMenu = await screen.findByRole('menu', { name: 'Ações da conexão Alpha' })
        expect(within(connMenu).getByRole('menuitem', { name: 'Abrir' })).toBeInTheDocument()
        expect(within(connMenu).getByRole('menuitem', { name: 'Editar' })).toBeInTheDocument()
        expect(within(connMenu).getByRole('menuitem', { name: 'Duplicar' })).toBeInTheDocument()
        expect(within(connMenu).getByRole('menuitem', { name: 'Copiar nome' })).toBeInTheDocument()
        expect(within(connMenu).getByRole('menuitem', { name: 'Excluir' })).toBeInTheDocument()

        // Escape closes cleanly
        fireEvent.keyDown(connMenu, { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('menu', { name: 'Ações da conexão Alpha' })).toBeNull())

        // Right-click Delete opens ConfirmDialog without immediate deletion (RT-3)
        fireEvent.contextMenu(alphaBtn)
        const connMenu2 = await screen.findByRole('menu', { name: 'Ações da conexão Alpha' })
        fireEvent.click(within(connMenu2).getByRole('menuitem', { name: 'Excluir' }))
        expect(await screen.findByRole('dialog', { name: /Excluir “Alpha”\?/ })).toBeInTheDocument()
        expect(api.callsOf('connections.delete')).toHaveLength(0)
        connView.unmount()

        // 2) OxeQueryView open tab context menu (Fechar, Fechar outras, Fechar à direita)
        const tabsView = render(<OxeQueryView active={false} />)
        const betaTab = screen.getByRole('tab', { name: 'Beta' })
        fireEvent.contextMenu(betaTab)

        const tabMenu = await screen.findByRole('menu', { name: 'Ações da aba Beta' })
        expect(within(tabMenu).getByRole('menuitem', { name: 'Fechar' })).toBeInTheDocument()
        expect(within(tabMenu).getByRole('menuitem', { name: 'Fechar outras' })).toBeInTheDocument()
        expect(within(tabMenu).getByRole('menuitem', { name: 'Fechar à direita' })).toBeInTheDocument()

        // Close to right removes Gamma while preserving Alpha and Beta
        fireEvent.click(within(tabMenu).getByRole('menuitem', { name: 'Fechar à direita' }))
        expect(useOxeQueryStore.getState().tabs.map(t => t.id)).toEqual(['connection:c-a', 'connection:c-b'])

        // Close others keeps only Beta
        fireEvent.keyDown(screen.getByRole('tab', { name: 'Beta' }), { key: 'F10', shiftKey: true })
        const tabMenu2 = await screen.findByRole('menu', { name: 'Ações da aba Beta' })
        fireEvent.click(within(tabMenu2).getByRole('menuitem', { name: 'Fechar outras' }))
        expect(useOxeQueryStore.getState().tabs.map(t => t.id)).toEqual(['connection:c-b'])
        tabsView.unmount()
      }
    }
  })

  test('opens context menus on ResultGrid cells/headers and all SchemaTree node kinds', async () => {
    // 1) ResultGrid cell & header context menus
    const onCopy = vi.fn()
    const onOpenCell = vi.fn()
    const onSort = vi.fn()
    const gridView = render(
      <ResultGrid
        columns={['id', 'name']}
        types={['int4', 'text']}
        rows={[[1, 'alice'], [2, 'bob']]}
        onCopy={onCopy}
        onOpenCell={onOpenCell}
        onSort={onSort}
        label="Resultado"
      />
    )

    // Header right-click: Ordenar, Copiar nome da coluna, Ajustar largura + Fixar/Ocultar
    const nameHeader = screen.getAllByRole('columnheader').find(el => el.textContent?.startsWith('name'))!
    fireEvent.contextMenu(nameHeader)
    const headerMenu = await screen.findByRole('menu')
    expect(within(headerMenu).getByRole('menuitem', { name: 'Ordenar' })).toBeInTheDocument()
    expect(within(headerMenu).getByRole('menuitem', { name: 'Copiar nome da coluna' })).toBeInTheDocument()
    expect(within(headerMenu).getByRole('menuitem', { name: 'Ajustar largura' })).toBeInTheDocument()

    fireEvent.click(within(headerMenu).getByRole('menuitem', { name: 'Copiar nome da coluna' }))
    expect(onCopy).toHaveBeenCalledWith('name', undefined)

    // Cell right-click: Copiar valor, Copiar linha (JSON), Ver detalhe
    const aliceCell = screen.getByRole('gridcell', { name: 'alice' })
    fireEvent.contextMenu(aliceCell)
    const cellMenu = await screen.findByRole('menu', { name: 'Ações da célula name' })
    expect(within(cellMenu).getByRole('menuitem', { name: 'Copiar valor' })).toBeInTheDocument()
    expect(within(cellMenu).getByRole('menuitem', { name: 'Copiar linha (JSON)' })).toBeInTheDocument()
    expect(within(cellMenu).getByRole('menuitem', { name: 'Ver detalhe' })).toBeInTheDocument()

    fireEvent.click(within(cellMenu).getByRole('menuitem', { name: 'Copiar linha (JSON)' }))
    expect(onCopy).toHaveBeenLastCalledWith(expect.stringContaining('"name": "alice"'), 'json')

    fireEvent.contextMenu(aliceCell)
    const cellMenu2 = await screen.findByRole('menu', { name: 'Ações da célula name' })
    fireEvent.click(within(cellMenu2).getByRole('menuitem', { name: 'Ver detalhe' }))
    expect(onOpenCell).toHaveBeenCalledWith({ column: 'name', type: 'text', value: 'alice', row: 0 })
    gridView.unmount()

    // 2) SchemaTree context menus on schema, category, and relation nodes
    const onInsert = vi.fn()
    const treeView = render(
      <SchemaTree connection={connection()} pinned={[]} onPinnedChange={vi.fn()} onOpen={vi.fn()} onInsert={onInsert} />
    )
    const publicSchema = await screen.findByRole('treeitem', { name: 'public' })
    fireEvent.contextMenu(publicSchema)
    const schemaMenu = await screen.findByRole('menu', { name: 'Ações de public' })
    expect(within(schemaMenu).getByRole('menuitem', { name: 'Atualizar' })).toBeInTheDocument()
    expect(within(schemaMenu).getByRole('menuitem', { name: 'Copiar nome' })).toBeInTheDocument()
    expect(within(schemaMenu).getByRole('menuitem', { name: 'Nova consulta' })).toBeInTheDocument()
    fireEvent.click(within(schemaMenu).getByRole('menuitem', { name: 'Nova consulta' }))
    expect(onInsert).toHaveBeenCalledWith('-- public\n')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    const tablesCategory = screen.getByRole('treeitem', { name: 'Tabelas' })
    fireEvent.contextMenu(tablesCategory)
    const categoryMenu = await screen.findByRole('menu', { name: 'Ações de Tabelas' })
    expect(within(categoryMenu).getByRole('menuitem', { name: 'Atualizar' })).toBeInTheDocument()
    expect(within(categoryMenu).getByRole('menuitem', { name: 'Copiar nome' })).toBeInTheDocument()
    fireEvent.keyDown(categoryMenu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    const usersRelation = screen.getByRole('treeitem', { name: 'users' })
    fireEvent.contextMenu(usersRelation)
    const relationMenu = await screen.findByRole('menu', { name: 'Ações de users' })
    expect(within(relationMenu).getByRole('menuitem', { name: 'Consultar' })).toBeInTheDocument()
    expect(within(relationMenu).getByRole('menuitem', { name: 'Estrutura' })).toBeInTheDocument()
    expect(within(relationMenu).getByRole('menuitem', { name: 'Copiar nome' })).toBeInTheDocument()
    expect(within(relationMenu).getByRole('menuitem', { name: 'Atualizar' })).toBeInTheDocument()
    treeView.unmount()
  })

  test('replaces Monaco default Command Palette F1 context menu with localized OxeQuery SQL editor menu', async () => {
    const locales: Array<{
      lang: 'pt-BR' | 'en'
      menuLabel: string
      expectedItems: string[]
    }> = [
      {
        lang: 'pt-BR',
        menuLabel: 'Menu do editor SQL',
        expectedItems: ['Executar consulta', 'Executar seleção', 'Formatar', 'Recortar', 'Copiar', 'Colar']
      },
      {
        lang: 'en',
        menuLabel: 'SQL editor menu',
        expectedItems: ['Run query', 'Run selection', 'Format', 'Cut', 'Copy', 'Paste']
      }
    ]

    for (const cfg of locales) {
      await changeLanguage(cfg.lang)
      const view = render(<SqlWorkbench connection={connection()} />)
      const editorMock = await screen.findByTestId('mock-sql-editor')
      await waitFor(() => expect(monacoOptionsSpy).toHaveBeenCalled())
      expect(monacoOptionsSpy.mock.calls.at(-1)?.[0]).toMatchObject({ contextmenu: false })

      const editorWrap = editorMock.closest('.oq-editor')!
      fireEvent.contextMenu(editorWrap)

      const menu = await screen.findByRole('menu', { name: cfg.menuLabel })
      const items = within(menu).getAllByRole('menuitem').map(el => el.textContent?.trim())
      expect(items).toEqual(cfg.expectedItems)
      expect(menu.textContent ?? '').not.toMatch(/Command Palette|\bF1\b/)

      // Verify Format invokes Monaco document formatter
      await act(async () => {
        fireEvent.click(within(menu).getByRole('menuitem', { name: cfg.expectedItems[2] }))
      })
      expect(mockFormatRun).toHaveBeenCalled()

      view.unmount()
    }
  })
})
