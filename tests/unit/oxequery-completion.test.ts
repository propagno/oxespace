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

describe('SchemaCache after a failed load', () => {
  it('asks the server again once the pause has passed', async () => {
    vi.useFakeTimers()
    try {
      const { oq } = await import('../../src/components/OxeQuery/client')
      const ask = vi.mocked(oq)
      ask.mockReset()
      ask.mockRejectedValueOnce(new Error('connection busy')).mockResolvedValue(['public'] as never)
      const cache = new SchemaCache('retry')
      expect(cache.schemaNames()).toEqual([])
      await vi.advanceTimersByTimeAsync(0)
      expect(cache.schemaNames()).toEqual([])
      expect(ask).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(3100)
      expect(cache.schemaNames()).toEqual([])
      await vi.advanceTimersByTimeAsync(0)
      expect(ask).toHaveBeenCalledTimes(2)
      expect(cache.schemaNames()).toEqual(['public'])
    } finally { vi.useRealTimers() }
  })
})

describe('schema-aware suggestions', () => {
  function withKeys(): SchemaCache {
    const cache = new SchemaCache('c2')
    cache.seed({
      schemas: ['public'],
      tables: { public: [{ name: 'users', kind: 'table' }, { name: 'orders', kind: 'table' }, { name: 'items', kind: 'table' }] },
      columns: {
        'public.users': [{ name: 'id', type: 'integer' }],
        'public.orders': [{ name: 'id', type: 'integer' }, { name: 'user_id', type: 'integer' }],
        'public.items': [{ name: 'order_id', type: 'integer' }]
      },
      foreignKeys: {
        'public.orders': [{ name: 'orders_user_fk', definition: 'FOREIGN KEY (user_id) REFERENCES users(id)' }],
        'public.items': [{ name: 'items_order_fk', definition: 'FOREIGN KEY (order_id) REFERENCES orders(id)' }]
      }
    })
    return cache
  }
  it('offers a joined table with its ON condition from an outgoing foreign key', () => {
    const text = 'SELECT * FROM orders o JOIN '
    const join = suggest(withKeys(), text, text).filter(item => item.kind === 'join')
    expect(join.map(item => item.insert)).toContain('users u ON u.id = o.user_id')
  })
  it('offers tables whose key points at a table already in the statement', () => {
    const text = 'SELECT * FROM orders o JOIN it'
    const join = suggest(withKeys(), text, text).filter(item => item.kind === 'join')
    expect(join.map(item => item.insert)).toEqual(['items i ON i.order_id = o.id'])
  })
  it('writes the ON condition between the joined table and the earlier ones', () => {
    const text = 'SELECT * FROM users u JOIN orders o ON '
    const items = suggest(withKeys(), text, text).filter(item => item.kind === 'join')
    expect(items.map(item => item.insert)).toEqual(['o.user_id = u.id'])
  })
  it('does not suggest joins outside a JOIN, nor tables already joined', () => {
    const text = 'SELECT * FROM orders o JOIN users u ON u.id = o.user_id JOIN '
    expect(suggest(withKeys(), text, text).filter(item => item.kind === 'join').map(item => item.label)).toEqual(['items'])
    const plain = 'SELECT * FROM orders o WHERE '
    expect(suggest(withKeys(), plain, plain).some(item => item.kind === 'join')).toBe(false)
  })
  it('completes CTE names and their columns', () => {
    const text = 'WITH recent AS (SELECT id, total FROM orders) SELECT r. FROM recent r'
    const before = 'WITH recent AS (SELECT id, total FROM orders) SELECT r.'
    expect(suggest(withKeys(), text, before).map(item => item.label)).toEqual(['id', 'total'])
    const from = 'WITH recent AS (SELECT 1) SELECT * FROM re'
    expect(suggest(withKeys(), from, from).filter(item => item.kind === 'cte').map(item => item.label)).toEqual(['recent'])
  })
  it('only reads the statement under the cursor', () => {
    const text = 'SELECT * FROM users u; SELECT o. FROM orders o'
    const before = 'SELECT * FROM users u; SELECT o.'
    expect(suggest(withKeys(), text, before).map(item => item.label)).toEqual(['id', 'user_id'])
    expect(suggest(withKeys(), text, 'SELECT * FROM users u; SELECT u.')).toEqual([])
  })
  it('suggests dialect functions for a typed prefix only', () => {
    expect(suggest(withKeys(), 'SELECT date_t', 'SELECT date_t').some(item => item.kind === 'function' && item.label === 'date_trunc')).toBe(true)
    expect(suggest(withKeys(), 'SELECT ', 'SELECT ').some(item => item.kind === 'function')).toBe(false)
  })
})
