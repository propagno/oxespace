// Frozen acceptance test for CR-05 (DESIGN, fidelity) and CR-07 (FRONTEND, a11y) on #610 (OXE phase F1, A8).
// The executor must not edit it.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
const cssFiles = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap(name => {
  const path = `${dir}/${name}`
  return statSync(join(ROOT, path)).isDirectory() ? cssFiles(path) : name.endsWith('.css') ? [path] : []
})
// Changed on 2026-11-14 by the coordinator's decision (user's delegation of 14/11)
const PALETTE = ['Velho Chico', 'Anil', 'Açude', 'Juazeiro', 'Xique-xique', 'Coroa-de-frade', 'Fim de tarde', 'Pedra']

describe('CR-05 · the workspace color matches the approved playground', () => {
  test.each(['shared/locales/en/common.json', 'shared/locales/pt-BR/common.json'])('%s names the eight swatches by the palette', path => {
    const catalog = JSON.parse(read(path)) as { workspaceColor?: Record<string, unknown> }
    const text = JSON.stringify(catalog.workspaceColor ?? {})
    for (const name of PALETTE) expect(text).toContain(name)
    expect(text).not.toMatch(/\{\{\s*number\s*\}\}/)
  })

  // Changed on 2026-11-14 for BRD-01 (OXE-60, OxeCode F5 T23): released by the coordinator, the user's decision of 13/11
  // (MARCA-LATERAIS): the OxeCode workspace is a sidebar row whose color shows as the dot, with no card and no tint.
  // SOURCE-TEXT check (marked): the stylesheets are what this criterion reads.
  test('the OxeCode workspace color shows as the dot, in both themes; no card strip and no tint', () => {
    const rules = cssFiles('src').flatMap(path => [...read(path).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selector, body]) => ({ path, selector: selector.trim(), body })))
    const workspaceRow = rules.filter(rule => /\.ws-group\b|\.sidebar-workspace-tree\b/.test(rule.selector))
    expect(workspaceRow.filter(rule => /inset\s+\d+px\s+0\s+0\s+var\(--ws\)/.test(rule.body)).map(rule => `${rule.path} ${rule.selector}`), 'no card strip').toEqual([])
    expect(workspaceRow.filter(rule => /color-mix\([^;]*var\(--ws\)/.test(rule.body)).map(rule => `${rule.path} ${rule.selector}`), 'no tint of the workspace color').toEqual([])
    expect(rules.filter(rule => /\[data-ws\]/.test(rule.selector) && /(^|;)\s*background(-color)?\s*:\s*var\(--ws\)\s*(;|$)/.test(rule.body.trim())).length,
      'a [data-ws] dot is filled with var(--ws)').toBeGreaterThan(0)
    const tokens = read('src/styles/tokens.generated.css')
    for (const mode of ['light', 'dark']) {
      const start = tokens.indexOf(`[data-mode='${mode}']`)
      const block = tokens.slice(start, tokens.indexOf('}', start))
      for (let n = 1; n <= 8; n++) expect(block, `--ws-${n} in the ${mode} theme`).toContain(`--ws-${n}:`)
    }
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
