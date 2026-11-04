import { describe, expect, it } from 'vitest'
import { withDangerSeparators, type MenuEntry } from '../src/ui/Overlay'

/** G-08/P-01: a destructive item stands apart from the others in every menu built on ui/Menu. */
const item = (label: string, danger = false): MenuEntry => ({ label, onSelect: () => undefined, ...(danger ? { danger } : {}) })
const shape = (entries: MenuEntry[]): string[] => entries.map(entry => entry.type === 'separator' ? '—' : 'label' in entry ? String(entry.label) : '?')

describe('withDangerSeparators', () => {
  it('puts a separator before the first destructive item of a run', () => {
    expect(shape(withDangerSeparators([item('Rename'), item('Move'), item('Delete', true), item('Delete all', true)]))).toEqual(['Rename', 'Move', '—', 'Delete', 'Delete all'])
  })

  it('adds none when one is there already, after a label, or at the top', () => {
    expect(shape(withDangerSeparators([item('Rename'), { type: 'separator' }, item('Delete', true)]))).toEqual(['Rename', '—', 'Delete'])
    expect(shape(withDangerSeparators([{ type: 'label', label: 'Danger' }, item('Delete', true)]))).toEqual(['Danger', 'Delete'])
    expect(shape(withDangerSeparators([item('Delete', true), item('Rename')]))).toEqual(['Delete', 'Rename'])
  })
})
