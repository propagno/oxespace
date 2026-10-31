import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTROL, SPACE, TARGET_MIN } from '../src/design/tokens/scales'

/**
 * Design lint for WCAG 2.2 SC 2.5.8 (Target Size, Minimum; roadmap F22): every interactive primitive in src/ui is at
 * least 24×24 CSS px in both densities. The primitives' CSS Modules are read, the rules that make up each target are
 * cascaded in order, the tokens are resolved per density (`--control-*`, `--space-*`, `--target-min`) and the box is
 * computed from height/min-height/block-size, width/min-width/inline-size and, as a floor under border-box, the
 * padding. A glyph may stay smaller (the 16 px checkbox box, the 18 px swatch) when its target is larger: the label, or
 * an inset that grows the button around the drawing. e2e/target-size.spec.ts measures the same in the running app.
 */
const ROOT = join(__dirname, '..')
const UI = join(ROOT, 'src/ui')
const DENSITIES = ['compact', 'comfortable'] as const
type Density = typeof DENSITIES[number]

/** `selector → declarations` of a stylesheet, layers flattened, in source order (a later rule wins). */
export function rules(css: string): Array<{ selector: string; declarations: Record<string, string> }> {
  const out: Array<{ selector: string; declarations: Record<string, string> }> = []
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of source.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    const declarations: Record<string, string> = {}
    for (const part of match[2].split(';')) {
      const colon = part.indexOf(':')
      if (colon > 0) declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim()
    }
    for (const selector of match[1].split(',')) out.push({ selector: selector.trim(), declarations })
  }
  return out
}

function tokens(density: Density): Record<string, string> {
  const out: Record<string, string> = { '--target-min': `${TARGET_MIN}px` }
  for (const [name, value] of Object.entries(CONTROL[density])) out[`--control-${name}`] = `${value}px`
  for (const [name, value] of Object.entries(SPACE)) out[`--space-${name}`] = value
  return out
}

/** A length in px: numbers, px, var() from `scope`, and calc() with + - * /. `undefined` when it is not a fixed length (auto, %, em). */
export function px(value: string | undefined, scope: Record<string, string>, depth = 0): number | undefined {
  if (value === undefined || depth > 8) return undefined
  const substituted = value.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, name: string, fallback?: string) => {
    const resolved = scope[name] ?? fallback
    const length = resolved === undefined ? undefined : px(resolved, scope, depth + 1)
    return length === undefined ? 'NaN' : `${length}px`
  })
  const expression = substituted.replace(/calc\(/g, '(').replace(/\bmax\(/g, 'M(').replace(/\bmin\(/g, 'm(').replace(/(\d*\.?\d+)px/g, '$1').trim()
  if (!/^[\d.\s+\-*/(),Mm]+$/.test(expression)) return undefined
  const result = Number(new Function('M', 'm', `return (${expression})`)(Math.max, Math.min))
  return Number.isFinite(result) ? result : undefined
}

function box(file: string, selectors: string[], density: Density): { width: number; height: number } {
  const all = rules(readFileSync(join(UI, file), 'utf8'))
  const declarations: Record<string, string> = {}
  for (const selector of selectors) {
    const found = all.filter(rule => rule.selector === selector)
    if (!found.length) throw new Error(`${file}: no rule for ${selector}`)
    for (const rule of found) Object.assign(declarations, rule.declarations)
  }
  const scope = { ...tokens(density), ...Object.fromEntries(Object.entries(declarations).filter(([name]) => name.startsWith('--'))) }
  const length = (name: string) => px(declarations[name], scope) ?? 0
  const padding = (declarations.padding ?? '0').split(/\s+(?![^(]*\))/).map(part => px(part, scope) ?? 0)
  const [top, right = top, bottom = top, left = right] = padding
  const border = 2 * (px((declarations.border ?? '').split(/\s+/)[0], scope) ?? 0)
  return {
    height: Math.max(length('height'), length('block-size'), length('min-height'), length('min-block-size'), (length('padding-block') * 2 || top + bottom) + border),
    width: Math.max(length('width'), length('inline-size'), length('min-width'), length('min-inline-size'), (length('padding-inline') * 2 || left + right) + border)
  }
}

/**
 * The targets, as the rules that build each one in the order they cascade. A text button's width also has its
 * label; the padding floor is what is checked here, the label only makes it wider.
 */
const TARGETS: Array<{ name: string; file: string; selectors: string[]; fillsWidth?: string }> = [
  { name: 'Button md', file: 'Button.module.css', selectors: ['.button'] },
  { name: 'Button sm', file: 'Button.module.css', selectors: ['.button', '.sm'] },
  { name: 'Button lg', file: 'Button.module.css', selectors: ['.button', '.lg'] },
  { name: 'icon-only Button / IconButton md', file: 'Button.module.css', selectors: ['.button', '.icon'] },
  { name: 'IconButton sm (Dialog and Toast close)', file: 'Button.module.css', selectors: ['.button', '.sm', '.icon'] },
  { name: 'IconButton lg', file: 'Button.module.css', selectors: ['.button', '.lg', '.icon'] },
  { name: 'Checkbox (its label is the target)', file: 'Field.module.css', selectors: ['.check'] },
  { name: 'Switch', file: 'Field.module.css', selectors: ['.switch'] },
  { name: 'SegmentedControl option (radio)', file: 'Field.module.css', selectors: ['.segment'] },
  { name: 'Swatch', file: 'Field.module.css', selectors: ['.swatch'] },
  { name: 'Tab', file: 'Display.module.css', selectors: ['.tab'] },
  { name: 'Menu item (also checkbox and radio items)', file: 'Overlay.module.css', selectors: ['.menuItem'], fillsWidth: 'an item spans the menu, which is wider than any target' }
]

/**
 * Rules in src/ui that draw something clickable smaller than 24 px on purpose, because a larger target wraps them.
 * Each says what the target is.
 */
const GLYPHS: Record<string, string> = {
  '.check input': 'the 16 px box of Checkbox; the label around it is the target (min-block-size: --target-min)',
  '.swatch::before': 'the 18 px colour dot of a swatch; the button around it is 24×24'
}

describe('design lint: target size (WCAG 2.5.8)', () => {
  it('resolves tokens, calc() and the padding floor', () => {
    const scope = { '--a': '28px', '--b': 'var(--a)' }
    expect(px('calc(var(--b) - 6px)', scope)).toBe(22)
    expect(px('var(--missing, 24px)', scope)).toBe(24)
    expect(px('auto', scope)).toBeUndefined()
    expect(px('max(var(--target-min, 24px), calc(var(--a) - 6px))', scope)).toBe(24)
    expect(px('min(var(--a), 20px)', scope)).toBe(20)
    expect(rules('@layer x { .a, .b { height: 1px } }').map(rule => rule.selector)).toEqual(['.a', '.b'])
  })

  for (const density of DENSITIES) {
    it(`every interactive primitive is at least ${TARGET_MIN}×${TARGET_MIN} px (${density})`, () => {
      const report = TARGETS.flatMap(target => {
        const size = box(target.file, target.selectors, density)
        return (target.fillsWidth || size.width >= TARGET_MIN) && size.height >= TARGET_MIN ? [] : [`${target.name}: ${size.width}×${size.height}`]
      })
      expect(report).toEqual([])
    })
  }

  it('no clickable rule in src/ui is drawn under 24 px unless a larger target wraps it', () => {
    const report = readdirSync(UI).filter(name => name.endsWith('.module.css')).flatMap(file =>
      rules(readFileSync(join(UI, file), 'utf8')).flatMap(rule => {
        if (rule.declarations.cursor !== 'pointer' || GLYPHS[rule.selector]) return []
        return DENSITIES.flatMap(density => {
          const scope = tokens(density)
          const small = ['height', 'block-size', 'min-height', 'min-block-size', 'width', 'inline-size']
            .filter(name => { const value = px(rule.declarations[name], scope); return value !== undefined && value < TARGET_MIN })
          return small.length ? [`${file} ${rule.selector} (${density}): ${small.map(name => `${name} ${rule.declarations[name]}`).join(', ')}`] : []
        })
      }))
    expect(report).toEqual([])
  })

  it('a primitive that makes a <div>/<span role="button"> or an <a> with a handler names it as a measured target', () => {
    // None today: Button, IconButton and the Radix items are the clickable primitives. A new one must join TARGETS.
    const MEASURED = new Set<string>(TARGETS.map(target => target.file.replace('.module.css', '.tsx')))
    const report = readdirSync(UI).filter(name => name.endsWith('.tsx')).flatMap(file => {
      const source = readFileSync(join(UI, file), 'utf8')
      const hits = [...source.matchAll(/role=["']button["']|<a\b[^>]*\bon(?:Click|KeyDown)=/g)]
      return hits.length && !MEASURED.has(file) ? [`${file}: ${hits.length} clickable element(s) not measured by TARGETS`] : []
    })
    expect(report).toEqual([])
  })

  it('the exemptions name rules that exist', () => {
    const selectors = new Set(readdirSync(UI).filter(name => name.endsWith('.module.css')).flatMap(file => rules(readFileSync(join(UI, file), 'utf8')).map(rule => rule.selector)))
    expect(Object.keys(GLYPHS).filter(selector => !selectors.has(selector))).toEqual([])
  })
})
