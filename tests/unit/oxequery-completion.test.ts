import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/components/OxeQuery/client', () => ({ oq: vi.fn() }))

import { analyzeContext, collectAliases, suggest, SchemaCache } from '../../src/components/OxeQuery/sql-completion'

function filled(): SchemaCache {
  const cache = new SchemaCache('c1')
  cache.seed({
    schemas: ['public', 'audit'],
    tables: { public: [{ name: 'users', kind: 'table' }, { name: 'orders', kind: 'table' }], audit: [{ name: 'events', kind: 'table' }] },
    columns: {
      'public.users': [{ name: 'id', type: 'integer' }, { name: 'email', type: 'text' }, { name: 'Full Name', type: 'text' }],
      'public.orders': [{ name: 'id', type: 'integer' }, { name: 'user_id', type: 'integer' }]
    }
  })
  return cache
}

describe('analyzeContext', () => {
  it('detects a qualifier and the partial column', () => {
    expect(analyzeContext('SELECT u.em')).toEqual({ qualifier: 'u', prefix: 'em' })
    expect(analyzeContext('SELECT u.')).toEqual({ qualifier: 'u', prefix: '' })
    expect(analyzeContext('SELECT "my table".')).toEqual({ qualifier: 'my table', prefix: '' })
    expect(analyzeContext('SELECT us')).toEqual({ prefix: 'us' })
  })
})

describe('collectAliases', () => {
  it('maps aliases and bare names, ignoring keywords after a table', () => {
    const map = collectAliases('SELECT * FROM users u JOIN audit.events AS e ON e.id = u.id WHERE u.id = 1')
    expect(map.get('u')).toEqual({ schema: 'public', table: 'users' })
    expect(map.get('e')).toEqual({ schema: 'audit', table: 'events' })
    const plain = collectAliases('SELECT * FROM orders WHERE id = 1')
    expect(plain.has('where')).toBe(false)
    expect(plain.get('orders')).toEqual({ schema: 'public', table: 'orders' })
  })
})

describe('suggest', () => {
  const cache = filled()
  it('suggests columns of an alias, quoting names that need it', () => {
    const text = 'SELECT u. FROM users u'
    const items = suggest(cache, text, 'SELECT u.')
    expect(items.map(item => item.label)).toEqual(['id', 'email', 'Full Name'])
    expect(items.find(item => item.label === 'Full Name')!.insert).toBe('"Full Name"')
  })
  it('suggests tables and keywords for a bare word', () => {
    const labels = suggest(cache, 'SELECT * FROM us', 'SELECT * FROM us').map(item => item.label)
    expect(labels).toContain('users')
    expect(labels).not.toContain('orders')
  })
  it('suggests the tables of a schema after `schema.`', () => {
    expect(suggest(cache, 'SELECT * FROM audit.', 'SELECT * FROM audit.').map(item => item.label)).toEqual(['events'])
  })
})
