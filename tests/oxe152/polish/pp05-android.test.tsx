import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16)
  ]
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(channel => {
    const s = channel / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

describe('OXE-267 · PP-05.12 AndroidPanel live badge contrast and CSS phone frame radius', () => {
  test('[css] .android-live-badge uses --intent-success-bg, --intent-success-border and --intent-success-fg with at least 4.5:1 contrast in both themes', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/Android/AndroidPanel.css'), 'utf8')
    const badgeBlock = css.match(/\.android-live-badge\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(badgeBlock).toMatch(/background\s*:\s*var\(--intent-success-bg\)/)
    expect(badgeBlock).toMatch(/border\s*:\s*1px solid var\(--intent-success-border\)/)
    expect(badgeBlock).toMatch(/color\s*:\s*var\(--intent-success-fg\)/)
    expect(badgeBlock).not.toContain('--intent-success-solid')
    expect(badgeBlock).not.toContain('--fill-hover')

    const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.generated.css'), 'utf8')
    const bgs = [...tokens.matchAll(/--intent-success-bg\s*:\s*(#[0-9a-fA-F]{6})/g)].map(m => m[1])
    const fgs = [...tokens.matchAll(/--intent-success-fg\s*:\s*(#[0-9a-fA-F]{6})/g)].map(m => m[1])
    expect(bgs.length).toBeGreaterThanOrEqual(2)
    expect(fgs.length).toBe(bgs.length)
    for (let i = 0; i < bgs.length; i++) {
      expect(contrastRatio(fgs[i], bgs[i])).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('[css] .android-phone-frame moves border-radius to CSS with --radius-* tokens and no inline style', () => {
    const tsx = readFileSync(resolve(process.cwd(), 'src/components/Android/AndroidPanel.tsx'), 'utf8')
    expect(tsx).not.toMatch(/android-phone-frame[^>]*style=/)
    expect(tsx).not.toContain("borderRadius: '34px'")

    const css = readFileSync(resolve(process.cwd(), 'src/components/Android/AndroidPanel.css'), 'utf8')
    const frameBlock = css.match(/\.android-phone-frame\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(frameBlock).toMatch(/border-radius\s*:[^;]*var\(--radius-/)
    expect(frameBlock).not.toMatch(/border-radius\s*:\s*\d+px/)
  })
})
