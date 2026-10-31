import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Static accessibility guards for what a DOM scan cannot see: a removed focus outline only matters
 * when the element is focused, and a spinner's name only when a screen reader reaches it.
 */
const ROOT = join(__dirname, '..')

function files(dir: string, match: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path, match) : match(path) ? [path] : []
  })
}

const rel = (path: string): string => relative(ROOT, path).split('\\').join('/')

/**
 * Every `outline: none` (or `0`) left in the app, per file, after the 1.4 audit. Each one has a visible
 * focus somewhere else:
 *  - a field inside a framed search box: the frame rings itself on :focus-within (controls.css);
 *  - the Thread composer textarea: the composer border takes the focus color;
 *  - a menu, command palette or review menu item: focus moves with the highlight, which is the item fill;
 *  - a dialog, tool panel, palette surface or schema-tree scroller: not in the tab order (focused by
 *    script only, or the rows inside take focus);
 *  - the command palette field: the row under it takes the focus color;
 *  - a splitter: the bar fills with the focus color.
 * Forced colors (high contrast) has its own ring for all of them in src/styles/forced-colors.css.
 * Adding one means giving the element one of these alternatives and raising its count here.
 */
const OUTLINE_NONE_ALLOWED: Record<string, number> = {
  'src/components/Changes/ChangesPanel.css': 3,
  'src/components/Navigation/AppMenuBar.css': 1,
  'src/components/Navigation/DetailList.css': 1,
  'src/components/Navigation/NavigationChrome.css': 1,
  'src/components/OxeQuery/OxeQuery.css': 3,
  'src/components/Settings/SettingsCenter.css': 2,
  'src/components/Threads/ThreadView.css': 1,
  'src/components/Threads/ThreadWorkbench.css': 1,
  'src/styles/components.css': 1,
  'src/styles/controls.css': 1,
  'src/styles/features/terminal.css': 1,
  'src/styles/mcp.css': 1,
  'src/styles/scripts-webpreview.css': 1,
  'src/styles/skills.css': 1,
  'src/ui/CommandPalette.module.css': 3,
  'src/ui/Overlay.module.css': 2,
  'src/ui/Splitter.module.css': 1,
  'src/ui/ToolPanel.module.css': 1
}

describe('static accessibility guards', () => {
  it('removes a focus outline only where another focus style stands in for it', () => {
    const found: Record<string, number> = {}
    for (const path of files(join(ROOT, 'src'), name => name.endsWith('.css'))) {
      const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const count = (css.match(/outline:\s*(?:none|0)\s*[;}]/g) ?? []).length
      if (count) found[rel(path)] = count
    }
    expect(found).toEqual(OUTLINE_NONE_ALLOWED)
  })

  it('gives every spinning icon a label or hides it from assistive technology', () => {
    const icon = /<(Loader2|LoaderCircle|Loader|RotateCw|RotateCcw|RefreshCw|RefreshCcw)\b([^>]*?)\/>/g
    const report: string[] = []
    for (const path of files(join(ROOT, 'src'), name => name.endsWith('.tsx'))) {
      const source = readFileSync(path, 'utf8')
      for (const match of source.matchAll(icon)) {
        const [element, name, attributes] = match
        const spins = name.startsWith('Loader') || /spin/i.test(attributes)
        if (spins && !/aria-hidden|aria-label/.test(attributes)) report.push(`${rel(path)}: ${element.slice(0, 100)}`)
      }
    }
    expect(report).toEqual([])
  })
})
