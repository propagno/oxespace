// Frozen acceptance test for CR-05 (DESIGN, fidelity) and CR-07 (FRONTEND, a11y) on #610 (OXE phase F1, A8).
// The executor must not edit it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
// Changed on 2026-11-14 by the coordinator's decision (user's delegation of 14/11)
const PALETTE = ['Velho Chico', 'Anil', 'Açude', 'Juazeiro', 'Xique-xique', 'Coroa-de-frade', 'Fim de tarde', 'Pedra']

describe('CR-05 · the workspace color matches the approved playground', () => {
  test.each(['shared/locales/en/common.json', 'shared/locales/pt-BR/common.json'])('%s names the eight swatches by the palette', path => {
    const catalog = JSON.parse(read(path)) as { workspaceColor?: Record<string, unknown> }
    const text = JSON.stringify(catalog.workspaceColor ?? {})
    for (const name of PALETTE) expect(text).toContain(name)
    expect(text).not.toMatch(/\{\{\s*number\s*\}\}/)
  })

  test('the OxeCode card strip runs the whole card; the active card name is --ws-fg on a 6% tint', () => {
    const css = read('src/design/workspace-color.css')
    expect(css).not.toMatch(/\.ws-group\[data-ws\]\s*>\s*\.ws-group-header\s*\{[^}]*inset 3px 0/)
    expect(css).toMatch(/\.ws-group\[data-ws\]\s*\{[^}]*var\(--ws\b/)
    expect(css).toMatch(/color-mix\([^)]*var\(--ws\)[^)]*6%/)
    expect(css).toMatch(/var\(--ws-fg\)/)
  })

  test('the pane header is a 2 px top line, 70% unfocused and full when focused, never a left strip', () => {
    const css = read('src/design/workspace-color.css')
    expect(css).not.toMatch(/\.pane-header\[data-ws\]\s*\{[^}]*inset 3px 0/)
    expect(css).toMatch(/\.pane-header\[data-ws\][^{]*\{[^}]*(inset 0 2px 0|border-top:\s*2px)/)
    expect(css).toMatch(/70%/)
  })

  test('the conversation header shows the workspace chip (name in --ws-fg on the tint)', () => {
    const css = read('src/design/workspace-color.css')
    const header = read('src/components/Threads/ThreadHeader.tsx')
    expect(css).toMatch(/\.thread-heading\[data-ws\]\s+\.thread-heading-context\s*\{[^}]*var\(--ws-fg\)/)
    expect(header).toMatch(/workspace\??\.name/)
  })
})

describe('CR-07 · the swatch picker is not a radiogroup inside role=menu', () => {
  test('the workspace context menu offers a "Workspace color…" item and does not embed the SwatchPicker', () => {
    const source = read('src/components/Sidebar/WorkspaceGroup.tsx')
    const menuStart = source.indexOf('ws-group-context-menu')
    expect(menuStart).toBeGreaterThan(-1)
    const menu = source.slice(menuStart, source.indexOf('</div>', source.indexOf('ws-group-context-separator', menuStart) + 1) + 2000)
    expect(menu).not.toMatch(/<SwatchPicker\b/)
    expect(source).toMatch(/workspaceColor\.(open|edit|choose|menuItem)/)
  })

  test('an axe check covers the workspace color picker once open', () => {
    const tests = read('tests/workspace-color-ui.test.tsx')
    expect(tests).toMatch(/axe|toHaveNoViolations/)
  })
})
