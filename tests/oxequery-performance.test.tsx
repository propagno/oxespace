import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ResultGrid } from '../src/components/OxeQuery/ResultGrid'
import { formatRows } from '../src/components/OxeQuery/grid-format'
import { buildRows, windowOf, type SchemaData } from '../src/components/OxeQuery/tree-model'

afterEach(() => cleanup())
const time = <T,>(run: () => T): { value: T; ms: number } => { const start = performance.now(); const value = run(); return { value, ms: performance.now() - start } }

describe('OxeQuery stays responsive with big results and big schemas', () => {
  it('mounts a 100 000-row grid by drawing only the rows in view', () => {
    const columns = ['id', 'name', 'email', 'note']
    const rows = Array.from({ length: 100_000 }, (_, index) => [index, `name ${index}`, `user${index}@example.com`, index % 7 === 0 ? null : 'x'.repeat(20)])
    const { ms } = time(() => render(<ResultGrid columns={columns} types={['int4', 'text', 'text', 'text']} rows={rows} onCopy={() => undefined} />))
    const drawn = screen.getAllByRole('row').length
    expect(drawn).toBeLessThan(200)
    expect(drawn).toBeGreaterThan(5)
    expect(ms).toBeLessThan(1500)
  })

  it('copies 100 000 rows as INSERT statements in well under a few seconds', () => {
    const columns = ['id', 'name']
    const rows = Array.from({ length: 100_000 }, (_, index) => [index, `name ${index}`])
    const { value, ms } = time(() => formatRows('insert', columns, rows, 'public.t'))
    expect(value.split('\n').length).toBeGreaterThanOrEqual(100_000)
    expect(ms).toBeLessThan(3000)
  })

  it('flattens a schema of 5 000 tables for the tree and windows it', () => {
    const data: SchemaData = {
      tables: Array.from({ length: 5000 }, (_, index) => ({ schema: 'public', name: `table_${String(index).padStart(5, '0')}`, kind: 'table' as const })),
      total: 5000, functions: [], objects: { sequences: [], types: [], triggers: [], truncated: false }
    }
    const { value: rows, ms } = time(() => buildRows({ schemas: ['public'], data: { public: data }, expanded: new Set(['schema/public', 'schema/public/tables']), pinned: [], extensions: [] }))
    expect(rows.length).toBe(5003)
    expect(ms).toBeLessThan(200)
    const slice = windowOf(rows.length, 26 * 2500, 520)
    expect(slice.end - slice.start).toBeLessThan(40)
  })
})
