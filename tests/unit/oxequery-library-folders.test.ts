import { describe, expect, it } from 'vitest'
import type { SavedQuery } from '../../shared/types/oxequery'
import { groupSaved } from '../../src/components/OxeQuery/library-folders'

const q = (name: string): SavedQuery => ({ id: name, connectionId: 'c', name, sql: 'SELECT 1', createdAt: 1, updatedAt: 1 })

describe('saved query folders', () => {
  it('uses the part before the first slash as the folder, with plain names on top', () => {
    const groups = groupSaved([q('Reports/Monthly'), q('Quick check'), q('admin/Users/active'), q('reports/Weekly')])
    expect(groups.map(group => group.folder)).toEqual(['', 'admin', 'Reports', 'reports'])
    expect(groups[0]!.items.map(item => item.label)).toEqual(['Quick check'])
    expect(groups[1]!.items[0]).toMatchObject({ label: 'Users/active' })
  })

  it('leaves a name with an empty side alone', () => {
    const groups = groupSaved([q('/lonely'), q('trailing/')])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.items.map(item => item.label)).toEqual(['/lonely', 'trailing/'])
  })
})
