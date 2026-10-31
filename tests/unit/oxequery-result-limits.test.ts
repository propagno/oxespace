import { describe, expect, it } from 'vitest'
import { capRowsByBytes } from '../../electron/main/services/oxequery/oxequery-core'

describe('capRowsByBytes', () => {
  it('keeps a result under the budget whole', () => {
    const rows = [[1, 'a'], [2, 'b']]
    expect(capRowsByBytes(rows, 100)).toEqual({ rows, cut: false })
  })

  it('cuts at the row that would pass the budget and always keeps at least one row', () => {
    const rows = Array.from({ length: 10 }, (_, index) => [index, 'x'.repeat(100)])
    const cut = capRowsByBytes(rows, 350)
    expect(cut.cut).toBe(true)
    expect(cut.rows.length).toBeGreaterThanOrEqual(1)
    expect(cut.rows.length).toBeLessThan(10)
    expect(capRowsByBytes([[ 'y'.repeat(1000) ]], 10).rows).toHaveLength(1)
  })
})
