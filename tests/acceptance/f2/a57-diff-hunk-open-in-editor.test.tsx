// Frozen acceptance test for 1.5.0 A57, part 2 (cockpit removal R11; OXE program, phase F2, task FE-R11). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R11).
// Contract, src/components/Changes/diffHunkOpen.ts (pure, no Monaco import at runtime):
// - hunkTargets(changes) takes Monaco's ILineChange[] (diffEditor.getLineChanges()) and returns one { line } per change:
//   its first modified line, or for a pure deletion (modifiedEndLineNumber 0) the line after it.
// - hunkDecorations(targets) returns one decoration per target on that line, drawn in the glyph margin
//   (options.glyphMarginClassName) with the hover "Open in editor at line N". No view zones (DESIGN, M5: FL-15).
// Contract, src/components/Changes/HunkOpenMenu.tsx: HunkOpenMenu({ targets, onOpen(line) }) is the file header's
// "Open in editor" button with one menu item per hunk, "Line N", named "Open in editor at line N".
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
// Modules this task creates load at run time, so a missing one fails its own checks, not the whole file.
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(ROOT, `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
type LineChange = { originalStartLineNumber: number; originalEndLineNumber: number; modifiedStartLineNumber: number; modifiedEndLineNumber: number }
type Decoration = { range: { startLineNumber: number }; options: { glyphMarginClassName?: string; glyphMarginHoverMessage?: unknown } }
type DiffHunkOpen = { hunkTargets: (changes: LineChange[]) => Array<{ line: number }>; hunkDecorations: (targets: Array<{ line: number }>) => Decoration[] }
const change = (originalStartLineNumber: number, originalEndLineNumber: number, modifiedStartLineNumber: number, modifiedEndLineNumber: number) =>
  ({ originalStartLineNumber, originalEndLineNumber, modifiedStartLineNumber, modifiedEndLineNumber, charChanges: undefined })

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('A57 · every diff hunk has Open in editor', () => {
  test('every changed hunk gets one Open in editor target at its first modified line', async () => {
    const { hunkTargets } = await load<DiffHunkOpen>('src/components/Changes/diffHunkOpen')
    // A modification at 10–12, an insertion at 41–44 (nothing on the original side), another modification at 88.
    expect(hunkTargets([change(10, 12, 10, 13), change(40, 0, 41, 44), change(86, 86, 88, 88)])).toEqual([{ line: 10 }, { line: 41 }, { line: 88 }])
    expect(hunkTargets([])).toEqual([])
  })

  test('a pure deletion opens the line after it', async () => {
    const { hunkTargets } = await load<DiffHunkOpen>('src/components/Changes/diffHunkOpen')
    // Lines 20–24 removed; on the modified side the change sits after line 19.
    expect(hunkTargets([change(20, 24, 19, 0)])).toEqual([{ line: 20 }])
  })

  test('the file header menu lists one item per hunk named Open in editor at line N', async () => {
    const onOpen = vi.fn()
    const { HunkOpenMenu } = await load<{ HunkOpenMenu: (props: { targets: Array<{ line: number }>; onOpen: (line: number) => void }) => JSX.Element }>('src/components/Changes/HunkOpenMenu')
    render(<HunkOpenMenu targets={[{ line: 41 }, { line: 88 }]} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: /^Open in editor/ }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map(item => item.getAttribute('aria-label') ?? item.textContent?.trim())).toEqual(['Open in editor at line 41', 'Open in editor at line 88'])
    expect(items.map(item => item.textContent?.trim())).toEqual(['Line 41', 'Line 88'])
    await userEvent.click(items[1])
    expect(onOpen).toHaveBeenCalledWith(88)
  })

  test('each hunk gets a glyph-margin action and no view zone', async () => {
    const { hunkDecorations } = await load<DiffHunkOpen>('src/components/Changes/diffHunkOpen')
    const decorations = hunkDecorations([{ line: 41 }, { line: 88 }])
    expect(decorations).toHaveLength(2)
    expect(decorations.map(decoration => decoration.range.startLineNumber)).toEqual([41, 88])
    for (const decoration of decorations) expect(decoration.options.glyphMarginClassName).toBeTruthy()
    expect(decorations.map(decoration => JSON.stringify(decoration.options.glyphMarginHoverMessage))).toEqual([
      expect.stringContaining('Open in editor at line 41'), expect.stringContaining('Open in editor at line 88')
    ])
    for (const file of ['src/components/Changes/diffHunkOpen.ts', 'src/components/Changes/MonacoDiff.tsx']) expect(read(file)).not.toMatch(/changeViewZones|addZone/)
    expect(read('src/components/Changes/MonacoDiff.tsx')).toMatch(/HunkOpenMenu/)
    expect(read('src/components/Changes/MonacoDiff.tsx')).toMatch(/glyphMargin:\s*true/)
  })
})
