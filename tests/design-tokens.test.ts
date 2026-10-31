import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrast, oklchToHex, over } from '../src/design/tokens/color'
import { moreContrastTokens, tokensCss } from '../src/design/tokens/css'
import { generateScale, SCALE_SPECS } from '../src/design/tokens/palette'
import { colorRoles } from '../src/design/tokens/semantic'

const MODES = ['light', 'dark'] as const

describe('design tokens', () => {
  it('match the committed generated CSS (run npm run tokens after editing a token)', () => {
    const committed = readFileSync(join(__dirname, '..', 'src', 'styles', 'tokens.generated.css'), 'utf8').replace(/\r\n/g, '\n')
    expect(committed).toBe(tokensCss())
  })

  it('converts OKLCH to sRGB and clamps to the gamut', () => {
    expect(oklchToHex({ l: 1, c: 0, h: 0 })).toBe('#ffffff')
    expect(oklchToHex({ l: 0, c: 0, h: 0 })).toBe('#000000')
    expect(oklchToHex({ l: 0.628, c: 0.2577, h: 29.23 })).toBe('#ff0000')
    expect(oklchToHex({ l: 0.7, c: 0.5, h: 150 })).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('has 12 steps per scale, ordered from the background towards the text', () => {
    for (const mode of MODES) for (const spec of Object.values(SCALE_SPECS)) {
      const scale = generateScale(spec, mode)
      expect(scale).toHaveLength(12)
      const background = scale[0]
      // Each step stands out from the background at least as much as the one before it (steps 1–8, then text).
      for (let step = 1; step < 8; step += 1) expect(contrast(scale[step], background)).toBeGreaterThanOrEqual(contrast(scale[step - 1], background) - 0.01)
      expect(contrast(scale[11], background)).toBeGreaterThan(contrast(scale[10], background))
    }
  })

  for (const mode of MODES) {
    describe(`${mode} mode`, () => {
      const roles = colorRoles(mode)
      const surfaces = ['surface-canvas', 'surface-base', 'surface-raised', 'surface-overlay', 'surface-chrome', 'surface-sunken']

      it('keeps every text level AA (4.5:1) on every surface', () => {
        for (const text of ['text-primary', 'text-secondary', 'text-muted', 'text-accent', 'text-link']) {
          for (const surface of surfaces) expect.soft(contrast(roles[text], roles[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
      })

      it('keeps text readable on selection and hover fills', () => {
        for (const fill of ['fill-hover', 'fill-pressed', 'fill-selected', 'fill-selected-strong', 'accent-soft']) {
          expect.soft(contrast(roles['text-primary'], roles[fill]), `text-primary on ${fill}`).toBeGreaterThanOrEqual(7)
          expect.soft(contrast(roles['text-secondary'], roles[fill]), `text-secondary on ${fill}`).toBeGreaterThanOrEqual(4.5)
        }
      })

      it('labels on solid fills and intent colors are AA', () => {
        expect(contrast(roles['text-on-accent'], roles.accent)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(roles['text-on-accent'], roles['accent-hover'])).toBeGreaterThanOrEqual(4.5)
        for (const solid of ['danger', 'success', 'info']) expect.soft(contrast(roles['text-on-solid'], roles[`intent-${solid}-solid`]), `label on ${solid} solid`).toBeGreaterThanOrEqual(4.5)
        for (const intent of ['success', 'warning', 'danger', 'info']) {
          expect.soft(contrast(roles[`intent-${intent}-fg`], roles[`intent-${intent}-bg`]), `${intent} text on its background`).toBeGreaterThanOrEqual(4.5)
          expect.soft(contrast(roles[`intent-${intent}-fg`], roles['surface-raised']), `${intent} text on a raised surface`).toBeGreaterThanOrEqual(4.5)
        }
      })

      it('focus, strong borders and status solids are visible against surfaces (3:1)', () => {
        for (const surface of ['surface-canvas', 'surface-base', 'surface-raised']) {
          expect.soft(contrast(roles['focus-ring'], roles[surface]), `focus on ${surface}`).toBeGreaterThanOrEqual(3)
          for (const intent of ['success', 'warning', 'danger', 'info']) expect.soft(contrast(roles[`intent-${intent}-solid`], roles[surface]), `${intent} solid on ${surface}`).toBeGreaterThanOrEqual(3)
        }
      })

      it('keeps terminal colors readable on the terminal background (4.5:1)', () => {
        for (const name of ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'bright-black']) {
          expect.soft(contrast(roles[`ansi-${name}`], roles['surface-base']), `ansi-${name}`).toBeGreaterThanOrEqual(4.5)
          if (name !== 'white' && name !== 'bright-black') expect.soft(contrast(roles[`ansi-bright-${name}`], roles['surface-base']), `ansi-bright-${name}`).toBeGreaterThanOrEqual(4.5)
        }
      })

      it('keeps diff text readable', () => {
        for (const fill of ['diff-add-bg', 'diff-del-bg', 'diff-add-strong', 'diff-del-strong']) expect.soft(contrast(roles['text-primary'], roles[fill]), fill).toBeGreaterThanOrEqual(7)
      })

      it('separates the warning from the accent', () => {
        expect(roles['intent-warning-solid']).not.toBe(roles.accent)
        // A warning must not read as the accent: their hues sit at least 15° apart.
        const accentHue = (mode === 'light' ? SCALE_SPECS.caatinga : SCALE_SPECS.sun).hue
        expect(Math.abs(SCALE_SPECS.warning.hue - accentHue)).toBeGreaterThanOrEqual(15)
      })
    })
  }

  it('raises contrast when the system asks for more: borders take the strong step, muted text reads as secondary', () => {
    expect(tokensCss()).toContain('@media (prefers-contrast: more)')
    for (const mode of ['light', 'dark'] as const) {
      const roles = colorRoles(mode), more = moreContrastTokens(mode)
      expect(more['border-subtle']).toBe(roles['border-strong'])
      expect(more['text-muted']).toBe(roles['text-secondary'])
      // Muted text gains contrast on every surface it sits on.
      for (const surface of ['surface-canvas', 'surface-base', 'surface-raised'] as const) expect(contrast(more['text-muted'], roles[surface])).toBeGreaterThan(contrast(roles['text-muted'], roles[surface]))
    }
  })

  it('composites overlays for contrast checks', () => {
    expect(over('#000000', 0.5, '#ffffff')).toBe('#808080')
  })
})
