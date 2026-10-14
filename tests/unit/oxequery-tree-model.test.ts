import { describe, expect, it } from 'vitest'
import type { SqlTable } from '../../shared/types/oxequery'
import { ROW_HEIGHT, buildRows, keyMove, rowsFromHits, windowOf, type SchemaData } from '../../src/components/OxeQuery/tree-model'

const table = (name: string, kind: SqlTable['kind'] = 'table'): SqlTable => ({ schema: 'public', name, kind })
const data: SchemaData = {
  tables: [table('users'), table('orders'), table('active_users', 'view'), table('daily', 'materialized view')],
  total: 4,
  functions: [{ oid: 1, name: 'touch', args: '', kind: 'function' }],
  objects: { sequences: [], types: [{ oid: 2, name: 'mood', kind: 'enum', values: ['a'] }], triggers: [], truncated: false }
}

describe('tree rows', () => {
  it('lists only categories that have something, tables always, in a fixed order', () => {
    const rows = buildRows({ schemas: ['public'], data: { public: data }, expanded: new Set(['schema/public']), pinned: [], extensions: null })
    expect(rows.map(row => `${row.level}:${row.label}`)).toEqual(['1:public', '2:Tables', '2:Views', '2:Materialized views', '2:Functions', '2:Types'])
  })

  it('shows the items of an open category and says when the list was cut short', () => {
    const rows = buildRows({ schemas: ['public'], data: { public: { ...data, total: 9000 } }, expanded: new Set(['schema/public', 'schema/public/tables']), pinned: [], extensions: null })
    expect(rows.filter(row => row.type === 'item').map(row => row.label)).toEqual(['users', 'orders'])
    expect(rows.find(row => row.type === 'note')?.label).toBe('Showing 4 of 9000 relations. Search to reach the rest.')
  })

  it('puts pinned tables first and extensions last', () => {
    const rows = buildRows({
      schemas: ['public'], data: {}, expanded: new Set(['pinned', 'extensions']), pinned: [{ schema: 'sales', name: 'invoices', kind: 'table' }],
      extensions: [{ name: 'pgcrypto', version: '1.3', schema: 'public' }]
    })
    expect(rows.map(row => row.label)).toEqual(['Pinned', 'sales.invoices', 'public', 'Extensions', 'pgcrypto 1.3'])
  })

  it('turns search hits into openable rows', () => {
    const rows = rowsFromHits([{ kind: 'table', schema: 'public', name: 'users' }, { kind: 'function', schema: 'public', name: 'touch', args: 'i integer', oid: 7 }])
    expect(rows.map(row => [row.label, row.item?.kind])).toEqual([['users', 'relation'], ['touch(i integer)', 'function']])
  })
})

describe('keyboard', () => {
  const rows = buildRows({ schemas: ['public', 'audit'], data: { public: data }, expanded: new Set(['schema/public', 'schema/public/tables']), pinned: [], extensions: null })
  const at = (label: string): number => rows.findIndex(row => row.label === label)

  it('moves between rows and stops at the ends', () => {
    expect(keyMove(rows, 0, 'ArrowDown')).toEqual({ focus: 1 })
    expect(keyMove(rows, 0, 'ArrowUp')).toBeNull()
    expect(keyMove(rows, rows.length - 1, 'ArrowDown')).toBeNull()
    expect(keyMove(rows, 3, 'End')).toEqual({ focus: rows.length - 1 })
    expect(keyMove(rows, 3, 'Home')).toEqual({ focus: 0 })
  })

  it('opens a closed branch, enters an open one and closes it from the left', () => {
    expect(keyMove(rows, at('audit'), 'ArrowRight')).toEqual({ expand: 'schema/audit' })
    expect(keyMove(rows, at('public'), 'ArrowRight')).toEqual({ focus: at('public') + 1 })
    expect(keyMove(rows, at('public'), 'ArrowLeft')).toEqual({ collapse: 'schema/public' })
    // From a leaf, Left goes to its parent.
    expect(keyMove(rows, at('users'), 'ArrowLeft')).toEqual({ focus: at('Tables') })
  })
})

describe('windowing', () => {
  it('renders the visible rows plus a margin', () => {
    expect(windowOf(5000, 0, 260)).toEqual({ start: 0, end: 10 + 6 })
    expect(windowOf(5000, ROW_HEIGHT * 1000, 260)).toEqual({ start: 994, end: 1016 })
    expect(windowOf(10, ROW_HEIGHT * 1000, 260)).toEqual({ start: 994, end: 10 })
  })
})
