// OXE-342 (HML round 1): Settings opened at `top: 36px` while the title bar is var(--bar-lg), 40px in the comfortable
// density, so the dialog covered the bar's lower 4px. The dialog starts where the bar ends, at every density.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/components/Settings/SettingsCenter.css'), 'utf8')
const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.generated.css'), 'utf8')

describe('OXE-342 · Settings below the title bar', () => {
  test('the framed Settings starts at the title bar height token, not a fixed pixel value', () => {
    // The base rule pins `inset: 0`; the framed rule after it moves the top edge. The last `top` set wins.
    const tops = [...css.matchAll(/^\.settings-center \{([^}]*)\}/gm)].map(match => match[1].match(/(?:^|;)\s*top: ([^;]+);/)?.[1]).filter(Boolean)
    expect(tops.at(-1), 'the framed Settings rule sets its top').toBe('var(--bar-lg)')
    expect(tops.some(value => /^\d+px$/.test(value!.trim()))).toBe(false)
  })

  test('the token differs between densities, which is why a fixed value drifts', () => {
    const values = [...tokens.matchAll(/--bar-lg: (\d+)px/g)].map(match => Number(match[1]))
    expect(new Set(values).size).toBeGreaterThan(1)
  })
})
