import { describe, expect, it } from 'vitest'
import { completeFilters, missingParameters, newTab, outputsFromScript, restoreWorkspace, serializeWorkspace } from '../../src/components/OxeQuery/workbench-model'

describe('workspace round trip', () => {
  it('saves text only and restores tabs without results, moving the id counter past them', () => {
    const first = newTab('SELECT 1', 'One')
    const second = { ...newTab('SELECT 2', 'Two'), pinned: true, outputs: [{ id: 's0', label: 'x', start: 0, text: 'x' }] }
    const saved = serializeWorkspace([first, second], second.id)
    expect(JSON.stringify(saved)).not.toContain('outputs')
    const restored = restoreWorkspace({ ...saved, tabs: [{ id: 'q40', title: 'Old', sql: 'SELECT 40' }, { id: 'q41', title: 'Older', sql: '' }], activeId: 'q41' })
    expect(restored.activeId).toBe('q41')
    expect(restored.tabs.every(tab => tab.outputs.length === 0)).toBe(true)
    expect(newTab().id).toBe('q42')
  })

  it('falls back to the first tab when the saved active one is gone', () => {
    expect(restoreWorkspace({ v: 1, activeId: 'nope', tabs: [{ id: 'a1', title: 'A', sql: '' }] }).activeId).toBe('a1')
  })
})

describe('script outputs', () => {
  it('labels each statement and places errors at the statement offset in the editor', () => {
    const outputs = outputsFromScript([
      { index: 0, start: 0, end: 8, sql: 'SELECT 1', result: { columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 1 } },
      { index: 1, start: 10, end: 30, sql: 'SELECT\n  *\n FROM nope', error: { code: 'query', message: 'relation "nope" does not exist', position: 17, sqlState: '42P01' } }
    ], 100, ['SELECT 1;', '', 'SELECT', '  *', ' FROM nope'].join('\n'))
    expect(outputs.map(output => output.label)).toEqual(['SELECT 1', 'SELECT * FROM nope'])
    expect(outputs[1]).toMatchObject({ start: 110, error: { position: 17, sqlState: '42P01' } })
  })
})

describe('parameters and filters', () => {
  it('reports the parameters that still need a value', () => {
    expect(missingParameters('SELECT * FROM t WHERE id = :id AND at > :since', { id: { value: '1', isNull: false } })).toEqual({ kind: 'named', names: ['id', 'since'], missing: ['since'] })
    expect(missingParameters('SELECT 1', {})).toEqual({ kind: 'none', names: [], missing: [] })
  })

  it('keeps only complete conditions', () => {
    expect(completeFilters([{ column: 'a', op: 'eq', value: '' }, { column: 'a', op: 'null' }, { column: '', op: 'eq', value: '1' }, { column: 'b', op: 'contains', value: 'x' }]))
      .toEqual([{ column: 'a', op: 'null' }, { column: 'b', op: 'contains', value: 'x' }])
  })
})

describe('lost connections', () => {
  it('recognizes what a dropped connection says, and not an ordinary query error', async () => {
    const { looksLikeLostConnection } = await import('../../src/components/OxeQuery/workbench-model')
    expect(looksLikeLostConnection('Connection terminated unexpectedly')).toBe(true)
    expect(looksLikeLostConnection('read ECONNRESET')).toBe(true)
    expect(looksLikeLostConnection('MongoNetworkError: connection 3 to host:27017 closed')).toBe(true)
    expect(looksLikeLostConnection('relation "users" does not exist')).toBe(false)
    // The MongoDB driver's own wording, without the error class in front.
    expect(looksLikeLostConnection('connection 5 to db.example.com:27017 closed')).toBe(true)
    expect(looksLikeLostConnection('connection d to S closed')).toBe(false)
  })
})
