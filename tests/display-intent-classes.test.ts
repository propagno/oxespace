import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// StatusDot, Badge and Toast add their status or intent as a class of this module (`styles[status]`). A bare rule
// with that name styles every one of them: a bare `.success` (SuccessState's padding) turned the running containers'
// dots in OxePod into large ovals. Status and intent names only ever appear compounded (`.dot.success`).
const INTENT_NAMES = ['success', 'danger', 'attention', 'running', 'warning', 'info', 'neutral', 'idle']

describe('Display.module.css', () => {
  test('has no bare rule named after a status or intent', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'ui', 'Display.module.css'), 'utf8')
    const bare = css.split('\n').filter(line => INTENT_NAMES.some(name => new RegExp(`^\\s*\\.${name}\\s*[{,]`).test(line)))
    expect(bare).toEqual([])
  })

  test('the status dot keeps a fixed round size whatever else its classes carry', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'ui', 'Display.module.css'), 'utf8')
    const dot = css.split('\n').find(line => line.startsWith('.dot {')) ?? ''
    for (const rule of ['width: 8px', 'height: 8px', 'padding: 0', 'aspect-ratio: 1', 'border-radius: 50%']) expect(dot).toContain(rule)
  })
})
