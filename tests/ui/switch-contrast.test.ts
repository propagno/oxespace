// Regression test for OXE-421: Switch thumb vs track contrast in OFF and ON states across Light and Dark themes
// (WCAG 1.4.11 Non-text Contrast >= 3.0:1). Covers both the design-system Switch (src/ui/Field.module.css) and the
// thread permissions toggle (.thread-config-switch in src/components/Threads/ThreadView.css).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { contrast } from '../../src/design/tokens/color'

const ROOT = join(__dirname, '..')
const REPO = join(ROOT, '..')

const LIGHT = ":root, [data-mode='light']"
const DARK = ":root[data-mode='dark'], [data-mode='dark']"
const SYSTEM_DARK = ':root:not([data-mode])'

const MODES = [
  ['light', LIGHT],
  ['dark', DARK],
  ['system dark', SYSTEM_DARK]
] as const

const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n')

/** Extract custom property declarations from a specific selector block in tokens.generated.css. */
function tokenBlock(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`tokens.generated.css missing block ${selector}`)
  const body = css.slice(at + selector.length + 2, css.indexOf('}', at))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]))
}

interface ParsedRule {
  selector: string
  declarations: Record<string, string>
  forced: boolean
}

/** Split a string by a top-level delimiter, ignoring delimiters inside () or []. */
function splitTopLevel(text: string, delimiter: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '(' || ch === '[') depth += 1
    else if (ch === ')' || ch === ']') depth -= 1
    else if (ch === delimiter && depth === 0) {
      out.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(text.slice(start).trim())
  return out.filter(Boolean)
}

/** Parse CSS rules while tracking whether each rule is inside `@media (forced-colors: active)`. */
function parseCssRules(css: string): ParsedRule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: ParsedRule[] = []

  const walk = (block: string, forced: boolean): void => {
    let i = 0
    while (i < block.length) {
      const open = block.indexOf('{', i)
      const semi = block.indexOf(';', i)
      if (open === -1) return
      if (semi !== -1 && semi < open && block.slice(i, semi).trim().startsWith('@')) {
        i = semi + 1
        continue
      }
      let depth = 1
      let close = open + 1
      for (; close < block.length && depth > 0; close += 1) {
        if (block[close] === '{') depth += 1
        else if (block[close] === '}') depth -= 1
      }
      const head = block.slice(i, open).trim()
      const body = block.slice(open + 1, close - 1)
      i = close

      if (head.startsWith('@')) {
        const nextForced = forced || /^@media\b/.test(head) && /forced-colors:\s*active/.test(head)
        walk(body, nextForced)
        continue
      }

      const declarations: Record<string, string> = {}
      for (const item of splitTopLevel(body, ';')) {
        const colon = item.indexOf(':')
        if (colon > 0) declarations[item.slice(0, colon).trim().toLowerCase()] = item.slice(colon + 1).trim()
      }
      for (const selector of splitTopLevel(head, ',')) {
        out.push({ selector, declarations, forced })
      }
    }
  }

  walk(source, false)
  return out
}

/** Merge declarations for an exact selector in source order. */
function declarationsFor(rules: ParsedRule[], selector: string, forced = false): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const rule of rules) {
    if (rule.forced === forced && rule.selector === selector) Object.assign(merged, rule.declarations)
  }
  return merged
}

/** Extract the CSS variable name from a declaration value such as `var(--tx-secondary)` or `1px solid var(--bd-control)`. */
function tokenName(value: string | undefined, context: string): string {
  const match = value ? /var\(\s*(--[\w-]+)\s*(?:,[^)]+)?\)/.exec(value) : null
  expect(match, `expected a CSS token in ${context}, got ${JSON.stringify(value)}`).not.toBeNull()
  return match![1]
}

/** Resolve a token name to its hex color in the given theme token map. */
function hexOf(tokens: Record<string, string>, token: string, mode: string): string {
  const hex = tokens[token] ?? ''
  expect(hex, `${mode}: token ${token} must resolve to a hex color`).toMatch(/^#[0-9a-f]{6}$/i)
  return hex
}

const TOKENS_CSS = read('src/styles/tokens.generated.css')
const FIELD_RULES = parseCssRules(read('src/ui/Field.module.css'))
const THREAD_RULES = parseCssRules(read('src/components/Threads/ThreadView.css'))
const FORCED_RULES = parseCssRules(read('src/styles/forced-colors.css'))

describe('OXE-421 · Switch thumb vs track contrast (WCAG 1.4.11 >= 3.0:1)', () => {
  const switchOffTrack = declarationsFor(FIELD_RULES, '.switch')
  const switchOffThumb = declarationsFor(FIELD_RULES, '.switch::after')
  const switchOffHoverThumb = declarationsFor(FIELD_RULES, ".switch:hover:not(:disabled):not([aria-checked='true'])::after")
  const switchOnTrack = declarationsFor(FIELD_RULES, ".switch[aria-checked='true']")
  const switchOnThumb = declarationsFor(FIELD_RULES, ".switch[aria-checked='true']::after")

  const threadOffTrack = declarationsFor(THREAD_RULES, '.thread-config-switch > i')
  const threadOffThumb = declarationsFor(THREAD_RULES, '.thread-config-switch > i::after')
  const threadOnTrack = declarationsFor(THREAD_RULES, ".thread-config-switch[aria-checked='true'] > i")
  const threadOnThumb = declarationsFor(THREAD_RULES, ".thread-config-switch[aria-checked='true'] > i::after")

  test('Field.module.css Switch thumb has >= 3.0:1 contrast against its track in OFF, OFF-hover and ON states across Light and Dark', () => {
    const offTrackTok = tokenName(switchOffTrack.background, '.switch background')
    const offBorderTok = tokenName(switchOffTrack.border, '.switch border')
    const offThumbTok = tokenName(switchOffThumb.background, '.switch::after background')
    const offHoverThumbTok = tokenName(switchOffHoverThumb.background, '.switch OFF hover thumb background')
    const onTrackTok = tokenName(switchOnTrack.background, ".switch[aria-checked='true'] background")
    const onThumbTok = tokenName(switchOnThumb.background, ".switch[aria-checked='true']::after background")

    expect(offTrackTok).toBe('--surface-sunken')
    expect(offBorderTok).toBe('--bd-control')
    expect(offThumbTok).toBe('--tx-secondary')
    expect(onTrackTok).toBe('--accent')
    expect(onThumbTok).toBe('--tx-on-accent')

    for (const [mode, selector] of MODES) {
      const tokens = tokenBlock(TOKENS_CSS, selector)
      const offTrack = hexOf(tokens, offTrackTok, mode)
      const offBorder = hexOf(tokens, offBorderTok, mode)
      const offThumb = hexOf(tokens, offThumbTok, mode)
      const offHoverThumb = hexOf(tokens, offHoverThumbTok, mode)
      const onTrack = hexOf(tokens, onTrackTok, mode)
      const onThumb = hexOf(tokens, onThumbTok, mode)

      expect(contrast(offThumb, offTrack), `${mode}: Switch OFF thumb (${offThumbTok}) on track (${offTrackTok})`).toBeGreaterThanOrEqual(3.0)
      expect(contrast(offHoverThumb, offTrack), `${mode}: Switch OFF hover thumb (${offHoverThumbTok}) on track (${offTrackTok})`).toBeGreaterThanOrEqual(3.0)
      expect(contrast(onThumb, onTrack), `${mode}: Switch ON thumb (${onThumbTok}) on track (${onTrackTok})`).toBeGreaterThanOrEqual(3.0)
      expect(contrast(offBorder, hexOf(tokens, '--surface-canvas', mode)), `${mode}: Switch OFF border on canvas`).toBeGreaterThanOrEqual(3.0)
      expect(contrast(offBorder, hexOf(tokens, '--surface-raised', mode)), `${mode}: Switch OFF border on raised`).toBeGreaterThanOrEqual(3.0)
    }
  })

  test('ThreadView.css .thread-config-switch aligns with Switch tokens and meets >= 3.0:1 contrast in OFF and ON states across Light and Dark', () => {
    const offTrackTok = tokenName(threadOffTrack.background, '.thread-config-switch > i background')
    const offBorderTok = tokenName(threadOffTrack.border, '.thread-config-switch > i border')
    const offThumbTok = tokenName(threadOffThumb.background, '.thread-config-switch > i::after background')
    const onTrackTok = tokenName(threadOnTrack.background, ".thread-config-switch[aria-checked='true'] > i background")
    const onBorderTok = tokenName(threadOnTrack['border-color'], ".thread-config-switch[aria-checked='true'] > i border-color")
    const onThumbTok = tokenName(threadOnThumb.background, ".thread-config-switch[aria-checked='true'] > i::after background")

    expect(offTrackTok).toBe('--surface-sunken')
    expect(offBorderTok).toBe('--bd-control')
    expect(offThumbTok).toBe('--tx-secondary')
    expect(onTrackTok).toBe('--accent')
    expect(onBorderTok).toBe('--accent')
    expect(onThumbTok).toBe('--tx-on-accent')

    for (const [mode, selector] of MODES) {
      const tokens = tokenBlock(TOKENS_CSS, selector)
      const offTrack = hexOf(tokens, offTrackTok, mode)
      const offThumb = hexOf(tokens, offThumbTok, mode)
      const onTrack = hexOf(tokens, onTrackTok, mode)
      const onThumb = hexOf(tokens, onThumbTok, mode)

      expect(contrast(offThumb, offTrack), `${mode}: .thread-config-switch OFF thumb on track`).toBeGreaterThanOrEqual(3.0)
      expect(contrast(onThumb, onTrack), `${mode}: .thread-config-switch ON thumb on track`).toBeGreaterThanOrEqual(3.0)
    }
  })

  test('ThreadView.css .thread-config-switch thumb geometry stays centered and symmetric with its 1px border', () => {
    expect(threadOffTrack['box-sizing']).toBe('border-box')
    expect(threadOffTrack.border).toMatch(/^1px\s+solid\s+var\(--bd-control\)$/)
    expect(threadOffTrack.width).toBe('28px')
    expect(threadOffTrack.height).toBe('16px')

    // Inner track box is 26x14 (28-2 by 16-2); a 12x12 thumb at top:1px left:1px leaves a 1px gap on all sides,
    // and translating by 12px lands at left:13px (13 + 12 + 1 = 26).
    expect(threadOffThumb.width).toBe('12px')
    expect(threadOffThumb.height).toBe('12px')
    expect(threadOffThumb.top).toBe('1px')
    expect(threadOffThumb.left).toBe('1px')
    expect(threadOnThumb.transform).toBe('translateX(12px)')
  })

  test('forced-colors overrides stay intact for Switch (including OFF hover) and .thread-config-switch', () => {
    expect(declarationsFor(FIELD_RULES, '.switch::after', true).background).toBe('CanvasText')
    expect(declarationsFor(FIELD_RULES, ".switch:hover:not(:disabled):not([aria-checked='true'])::after", true).background).toBe('CanvasText')
    expect(declarationsFor(FIELD_RULES, ".switch[aria-checked='true']::after", true).background).toBe('HighlightText')
    expect(declarationsFor(FIELD_RULES, '.switch:disabled::after', true).background).toBe('GrayText')

    expect(declarationsFor(FORCED_RULES, '.thread-config-switch > i', true).background).toBe('Canvas')
    expect(declarationsFor(FORCED_RULES, '.thread-config-switch > i::after', true).background).toBe('CanvasText')
    expect(declarationsFor(FORCED_RULES, ".thread-config-switch[aria-checked='true'] > i", true).background).toBe('Highlight')
    expect(declarationsFor(FORCED_RULES, ".thread-config-switch[aria-checked='true'] > i::after", true).background).toBe('HighlightText')
  })
})
