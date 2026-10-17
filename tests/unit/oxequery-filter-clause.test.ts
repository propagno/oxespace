import { describe, expect, it } from 'vitest'
import { buildFilterClause } from '../../electron/main/services/oxequery/filter-clause'

describe('buildFilterClause', () => {
  it('is empty without filters', () => {
    expect(buildFilterClause([])).toEqual({ where: '', params: [] })
  })

  it('quotes columns and sends every value as a parameter', () => {
    const { where, params } = buildFilterClause([
      { column: 'id', op: 'gte', value: '10' },
      { column: 'we"ird', op: 'eq', value: "x'; DROP TABLE t; --" },
      { column: 'deleted_at', op: 'null' },
      { column: 'name', op: 'contains', value: '50%_off' }
    ])
    expect(where).toBe(` WHERE "id" >= $1 AND "we""ird" = $2 AND "deleted_at" IS NULL AND "name"::text ILIKE $3`)
    expect(params).toEqual(['10', "x'; DROP TABLE t; --", String.raw`%50\%\_off%`])
    expect(where).not.toContain('DROP')
  })

  it('turns a list into one parameter and rejects what it cannot express', () => {
    const { where, params } = buildFilterClause([{ column: 'status', op: 'in', value: 'a, b ,c' }])
    expect(where).toContain('ANY (ARRAY(SELECT jsonb_array_elements_text($1::jsonb)))')
    expect(params).toEqual(['["a","b","c"]'])
    expect(() => buildFilterClause([{ column: 'status', op: 'in', value: ' , ' }])).toThrow(/at least one/)
    expect(() => buildFilterClause([{ column: '', op: 'eq', value: '1' }])).toThrow(/column/)
    expect(() => buildFilterClause([{ column: 'a', op: 'bogus' as never, value: '1' }])).toThrow(/not supported/)
    expect(() => buildFilterClause(Array.from({ length: 21 }, () => ({ column: 'a', op: 'null' as const })))).toThrow(/up to 20/)
  })
})
