// Frozen acceptance test for 1.5.0 CR-15 (spec gap, A8 × U4, OXE phase F1). The executor must not edit it.
// The approved playground draws the active workspace card on a 6% tint of its own color (CR-05/CR-07). U4's design lint
// counts every selected state whose background is not var(--fill-selected), so that approved tint read as one more
// stray selection (23 > 22, #610 CI). The tint is a sanctioned selection, but ONLY on a [data-ws] selector and ONLY as
// a color-mix of var(--ws). The ratchet is never raised to make room for it.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const LINT = readFileSync(join(ROOT, 'tests', 'design-lint.test.ts'), 'utf8')
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : path.endsWith('.css') ? [path] : []
})
const css = walk(join(ROOT, 'src')).filter(path => !/forced-colors\.css$/.test(path))

const SELECTED = /\[aria-selected=['"]?true['"]?\]|\[aria-current(=['"]?(page|true)['"]?)?\]|\[data-state=['"]?(active|checked|on)['"]?\]|\.(?:is-)?selected(?![\w-])|\.(?:is-)?active(?![\w-])|:checked/
const WORKSPACE_TINT = /^color-mix\(\s*in\s+srgb\s*,\s*var\(--ws\)\s+\d+%\s*,\s*transparent\s*\)$/

function strays(): string[] {
  return css.flatMap(path => {
    const source = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    return [...source.matchAll(/([^{}]+)\{([^}]*)\}/g)].flatMap(([, selector, body]) => {
      if (!SELECTED.test(selector) || /::?(?:before|after)(?![\w-])/.test(selector)) return []
      const background = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/.exec(body)?.[1].trim()
      if (!background || /var\(--(fill-selected|nav-selected)/.test(background) || /--intent-|^(transparent|none|inherit)$/.test(background)) return []
      const sanctionedTint = WORKSPACE_TINT.test(background) && selector.split(',').every(part => /\[data-ws\]/.test(part))
      return sanctionedTint ? [] : [`${relative(ROOT, path)} ${selector.trim()}`]
    })
  })
}

describe('CR-15 · the active workspace card tint is a sanctioned selection, and the ratchet does not grow', () => {
  test('the selected-state ratchet stays at 22 or lower (never raised)', () => {
    const limit = /LIMIT_SELECTED\s*=\s*(\d+)/.exec(LINT)
    expect(limit, 'tests/design-lint.test.ts declares LIMIT_SELECTED').not.toBeNull()
    expect(Number(limit![1])).toBeLessThanOrEqual(22)
  })

  test('stray selected backgrounds, with only the [data-ws] workspace tint excepted, stay within the ratchet', () => {
    const limit = Number(/LIMIT_SELECTED\s*=\s*(\d+)/.exec(LINT)![1])
    expect(strays().length).toBeLessThanOrEqual(limit)
  })

  test('the design lint itself knows the exception, scoped the same way (--ws tint on a [data-ws] selector)', () => {
    expect(LINT).toMatch(/--ws\b/)
    expect(LINT).toMatch(/data-ws/)
  })

  test('the approved tint is still there: the active card keeps a color-mix of var(--ws) on a [data-ws] selector', () => {
    const source = readFileSync(join(ROOT, 'src', 'design', 'workspace-color.css'), 'utf8')
    expect(source).toMatch(/\.ws-group\.active\[data-ws\][^{]*\{[^}]*background:\s*color-mix\(in srgb, var\(--ws\) 6%, transparent\)/)
  })
})
