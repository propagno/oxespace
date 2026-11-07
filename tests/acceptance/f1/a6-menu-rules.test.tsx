// Frozen acceptance test for 1.5.0 A6 (U7, OXE phase F1). The executor must not edit it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { orderMenuEntries, type MenuEntry } from '../../../src/ui/Overlay'

const ROOT = join(__dirname, '..', '..', '..')
const noop = (): void => undefined

describe('A6 · menu rules (U7)', () => {
  test('menus are 200–320 px wide', () => {
    const css = readFileSync(join(ROOT, 'src', 'ui', 'Overlay.module.css'), 'utf8')
    const start = css.search(/^\.menu\s*\{/m)
    expect(start).toBeGreaterThanOrEqual(0)
    const block = css.slice(start, css.indexOf('}', start))
    expect(block).toMatch(/min-width:\s*200px/)
    expect(block).toMatch(/max-width:\s*min\(\s*320px/)
  })

  test('destructive items go last, after one separator, keeping their own order', () => {
    const items: MenuEntry[] = [
      { label: 'Rename', onSelect: noop },
      { label: 'Delete', onSelect: noop, danger: true },
      { label: 'Duplicate', onSelect: noop },
      { label: 'Remove from list', onSelect: noop, danger: true },
      { label: 'Copy path', onSelect: noop }
    ]
    const ordered = orderMenuEntries(items)
    const labels = ordered.map(entry => ('label' in entry ? entry.label : `<${entry.type}>`))
    expect(labels).toEqual(['Rename', 'Duplicate', 'Copy path', '<separator>', 'Delete', 'Remove from list'])
  })

  test('a menu without destructive items is unchanged', () => {
    const items: MenuEntry[] = [{ label: 'A', onSelect: noop }, { type: 'separator' }, { label: 'B', onSelect: noop }]
    expect(orderMenuEntries(items)).toEqual(items)
  })

  test('an item can carry a hint line', () => {
    const entry: MenuEntry = { label: 'Caveman', onSelect: noop, hint: 'Shorter answers, fewer tokens' }
    expect(entry).toBeTruthy()
  })
})
