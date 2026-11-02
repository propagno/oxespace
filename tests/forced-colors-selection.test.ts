import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Forced colors (Windows high contrast) drops author backgrounds and shadows, which were the only mark of the chosen
 * option and of an on switch (roadmap F31, homologation P3-6/P3-7). Every selection primitive in src/ui keeps a mark
 * drawn in the Highlight system color inside `@media (forced-colors: active)`, and src/styles/forced-colors.css gives
 * the hand-made radios and pressed toggles the same. e2e/forced-colors-selection.spec.ts checks the running app.
 */
const ROOT = join(__dirname, '..')
const UI = join(ROOT, 'src/ui')
const SYSTEM_COLORS = /\b(?:Canvas|CanvasText|Highlight|HighlightText|ButtonText|ButtonFace|GrayText|LinkText|Mark|MarkText|AccentColor|AccentColorText|Field|FieldText)\b/

/** The bodies of every `@media (forced-colors: active)` block in `css`, braces balanced. */
export function forcedColorBlocks(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  for (const match of source.matchAll(/@media\s*\(forced-colors:\s*active\)\s*\{/g)) {
    let depth = 1
    let index = match.index + match[0].length
    const start = index
    while (depth > 0 && index < source.length) {
      if (source[index] === '{') depth++
      else if (source[index] === '}') depth--
      index++
    }
    out.push(source.slice(start, index - 1))
  }
  return out
}

/** The declarations of the rules in `block` whose selector list has `selector` (exactly, as one of its members). */
function declarationsFor(block: string, selector: string): string[] {
  return [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => match[1].split(/,(?![^(]*\))/).map(part => part.trim()).includes(selector))
    .map(match => match[2])
}

/** `role="radio"` / `role="switch"` elements of a primitive and the CSS Module class each one is drawn with. */
function selectionClasses(tsx: string): Array<{ role: string; className: string }> {
  return [...tsx.matchAll(/<\w+\b[^>]*?role="(radio|switch)"[^>]*?className=\{styles\.(\w+)\}/g)].map(match => ({ role: match[1], className: match[2] }))
}

describe('forced colors: the chosen option survives', () => {
  it('reads forced-colors blocks and selectors with commas inside :not()', () => {
    const css = '.a { color: red } @media (forced-colors: active) { .b, .c:not(.d, .e) { color: Highlight } @supports (x: y) { .f { color: Canvas } } }'
    expect(forcedColorBlocks(css)).toHaveLength(1)
    expect(declarationsFor(forcedColorBlocks(css)[0], '.c:not(.d, .e)')).toEqual([' color: Highlight '])
  })

  const field = readFileSync(join(UI, 'Field.module.css'), 'utf8')
  const forced = forcedColorBlocks(field).join('\n')

  it('every radio and switch drawn by a primitive has a Highlight mark for its chosen state under forced colors', () => {
    const found = readdirSync(UI).filter(name => name.endsWith('.tsx')).flatMap(file => {
      const tsx = readFileSync(join(UI, file), 'utf8')
      const module = /import styles from '\.\/([\w.]+\.module\.css)'/.exec(tsx)?.[1]
      return selectionClasses(tsx).map(item => ({ ...item, file, module }))
    })
    // SegmentedControl, SwatchPicker and Switch today; a new one joins automatically.
    expect(found.map(item => item.className).sort()).toEqual(expect.arrayContaining(['segment', 'swatch', 'switch']))
    const report = found.flatMap(item => {
      const blocks = item.module ? forcedColorBlocks(readFileSync(join(UI, item.module), 'utf8')).join('\n') : ''
      const marked = declarationsFor(blocks, `.${item.className}[aria-checked='true']`).some(body => /\bHighlight\b/.test(body))
      return marked ? [] : [`${item.file} ${item.role} .${item.className}: no Highlight rule for [aria-checked='true'] in @media (forced-colors: active)`]
    })
    expect(report).toEqual([])
  })

  it('the chosen segment also carries a tick, and the others keep a ButtonText edge', () => {
    expect(declarationsFor(forced, ".segment[aria-checked='true']::before").join(' ')).toMatch(/content:\s*'\\2713'/)
    expect(declarationsFor(forced, ".segment:not([aria-checked='true'], :focus-visible)").join(' ')).toMatch(/outline:[^;]*ButtonText/)
  })

  it('the switch draws its track and thumb in system colors, off and on', () => {
    const off = declarationsFor(forced, '.switch').join(' ')
    expect(off).toMatch(/forced-color-adjust:\s*none/)
    expect(off).toMatch(/border:\s*2px solid CanvasText/)
    expect(declarationsFor(forced, '.switch::after').join(' ')).toMatch(/background:\s*CanvasText/)
    expect(declarationsFor(forced, ".switch[aria-checked='true']").join(' ')).toMatch(/background:\s*Highlight/)
    expect(declarationsFor(forced, ".switch[aria-checked='true']::after").join(' ')).toMatch(/background:\s*HighlightText/)
  })

  it('a checked Checkbox takes Highlight', () => {
    expect(declarationsFor(forced, '.check input:checked').join(' ')).toMatch(/\bHighlight\b/)
  })

  it('hand-made radios and pressed toggles outside src/ui get the same mark (src/styles/forced-colors.css)', () => {
    const global = forcedColorBlocks(readFileSync(join(ROOT, 'src/styles/forced-colors.css'), 'utf8')).join('\n')
    // The current page of a navigation list (Settings' side nav) is a choice too (homologation of #271).
    const chosen = ":root :is([role='radio'][aria-checked='true']:not([data-swatch]), button[aria-pressed='true'], nav button[aria-current='page'], nav a[aria-current='page'])"
    const body = declarationsFor(global, chosen).join(' ')
    expect(body).toMatch(/forced-color-adjust:\s*none/)
    expect(body).toMatch(/background:\s*Highlight/)
    expect(body).toMatch(/color:\s*HighlightText/)
    expect(declarationsFor(global, ":root [role='radio']:not([aria-checked='true'], :focus-visible, [data-swatch])").join(' ')).toMatch(/ButtonText/)
    expect(declarationsFor(global, ".thread-config-switch[aria-checked='true'] > i").join(' ')).toMatch(/Highlight/)
  })

  it('system colors appear in the primitives only inside a forced-colors block', () => {
    const report = readdirSync(UI).filter(name => name.endsWith('.module.css')).flatMap(file => {
      const css = readFileSync(join(UI, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const outside = forcedColorBlocks(css).reduce((rest, block) => rest.replace(block, ''), css)
      return [...outside.matchAll(/:\s*([^;{}]*);/g)].filter(match => SYSTEM_COLORS.test(match[1]) && !/var\(/.test(match[1])).map(match => `${file}: ${match[0].trim()}`)
    })
    expect(report).toEqual([])
  })
})
