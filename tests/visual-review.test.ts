import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script without types
import { collect, page } from '../scripts/visual-review.mjs'

/** scripts/visual-review.mjs: the side-by-side page the visual gate uploads when a surface differs (F8). */
describe('visual review page', () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-visual-review-'))
  const dir = join(root, 'anchor-surfaces-empty-chromium')
  mkdirSync(dir, { recursive: true })
  for (const suffix of ['actual', 'expected', 'diff']) writeFileSync(join(dir, `empty-light-desktop-${suffix}.png`), '')
  writeFileSync(join(dir, 'splash-dark-actual.png'), '')

  it('pairs each surface that differs with its baseline and difference, and marks a new one', () => {
    const entries = collect(root) as Array<{ name: string; expected?: string; diff?: string }>
    expect(entries.map(entry => entry.name)).toEqual(['anchor-surfaces-empty-chromium / empty-light-desktop', 'anchor-surfaces-empty-chromium / splash-dark'])
    expect(entries[0].expected).toBeTruthy()
    expect(entries[0].diff).toBeTruthy()
    expect(entries[1].expected).toBeUndefined()
  })

  it('links the images relative to the page, so the downloaded folder opens as is', () => {
    const html = page(collect(root), root) as string
    expect(html).toContain('Visual review: 2 surfaces differ')
    expect(html).toContain('src="anchor-surfaces-empty-chromium/empty-light-desktop-expected.png"')
    expect(html).toContain('none: a new surface without a baseline')
    expect(page([], root)).toContain('No surface differs from its baseline.')
  })
})
