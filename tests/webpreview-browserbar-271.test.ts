// OXE-353 (HML round 2): in a real 960x720 window with the sidebar, the grid and the Browser open, the Browser panel
// is about 271px wide and the browserbar ran to ~310px, pushing "⋯" (Zoom, DevServer, DevTools, Screenshot) out of
// view. jsdom has no layout, so this adds up the bar the way the browser lays it out at that width, from the CSS that
// applies there (container web-preview ≤ 340px) and the tokens of both densities.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/styles/scripts-webpreview.css'), 'utf8')
const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.generated.css'), 'utf8')
const PANEL = 271

/** The body of `@container web-preview (max-width: Npx) { … }` (one level of nested rules). */
function containerBlock(px: number): string {
  const start = css.search(new RegExp(`@container\\s+web-preview\\s*\\(\\s*max-width:\\s*${px}px\\s*\\)\\s*\\{`))
  expect(start, `@container web-preview (max-width: ${px}px)`).toBeGreaterThan(-1)
  let depth = 0
  for (let index = css.indexOf('{', start); index < css.length; index++) {
    if (css[index] === '{') depth++
    if (css[index] === '}' && --depth === 0) return css.slice(start, index + 1)
  }
  throw new Error('unclosed container block')
}
const hides = (block: string, selector: string) => new RegExp(`\\${selector}\\s*\\{[^}]*display:\\s*none`).test(block)
const px = (value: string | undefined) => Number(value?.match(/(\d+)px/)?.[1])
/** Each density block of the tokens: its --control-sm, --space-1 and --space-2. */
const densities = [...tokens.matchAll(/--control-sm:\s*(\d+)px/g)].map(match => Number(match[1]))

describe('OXE-353 · the browserbar fits a 271px Browser panel', () => {
  test('at 340px or less the address gives way to 96px and Go leaves; ⋯ stays', () => {
    const narrow = containerBlock(340)
    expect(px(narrow.match(/\.web-preview-address-input\s*\{[^}]*min-width:\s*(\d+px)/)?.[1])).toBe(96)
    expect(hides(narrow, '.web-preview-go-button')).toBe(true)
    expect(hides(narrow, '.web-preview-overflow-menu')).toBe(false)
    // Already true from the wider breakpoints, and needed here.
    expect(hides(containerBlock(560), '.web-preview-secondary-controls')).toBe(true)
    expect(hides(containerBlock(355), '.web-preview-design-toggle')).toBe(true)
  })

  test.each(densities.map(control => [control]))('the visible controls add up to at most 271px (control %ipx)', control => {
    const space1 = px(tokens.match(/--space-1:\s*(\d+px)/)?.[1])
    const space2 = px(tokens.match(/--space-2:\s*(\d+px)/)?.[1])
    const address = px(containerBlock(340).match(/\.web-preview-address-input\s*\{[^}]*min-width:\s*(\d+px)/)?.[1])
    // Back, Forward, Reload, the address, ⋯ (IconButton sm = --control-sm square): five items, four gaps, two paddings.
    const items = [control, control, control, address, control]
    const width = items.reduce((sum, value) => sum + value, 0) + space1 * (items.length - 1) + space2 * 2
    expect(width).toBeLessThanOrEqual(PANEL)
  })
})
