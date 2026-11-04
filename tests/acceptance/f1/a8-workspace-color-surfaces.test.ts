// Frozen acceptance test for 1.5.0 A8, renderer side (OXE program, phase F1). The executor must not edit it.
// The color reaches every workspace surface through workspaceColorAttrs (data-ws), and the CSS reads only tokens.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

describe('A8 · the workspace color reaches every workspace surface', () => {
  test.each([
    ['the OxeCode workspace card', 'src/components/Sidebar/WorkspaceGroup.tsx'],
    ['the pane header', 'src/components/Grid/PaneContainer.tsx'],
    ['the conversation header', 'src/components/Threads/ThreadHeader.tsx']
  ])('%s spreads workspaceColorAttrs', (_name, path) => {
    const source = read(path)
    expect(source).toMatch(/workspaceColorAttrs\(/)
  })

  test('the workspace menu offers the eight colors through workspace:update-settings', () => {
    const source = read('src/components/Sidebar/WorkspaceGroup.tsx')
    expect(source).toMatch(/WORKSPACE_COLORS/)
    expect(source).toMatch(/updateSettings\([^)]*color/s)
  })

  test('workspace color CSS reads only the ws tokens through [data-ws]', () => {
    const css = read('src/design/workspace-color.css')
    for (let n = 1; n <= 8; n++) {
      expect(css).toContain(`[data-ws="${n}"]`)
      expect(css).toContain(`var(--ws-${n})`)
      expect(css).toContain(`var(--ws-${n}-fg)`)
    }
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})
