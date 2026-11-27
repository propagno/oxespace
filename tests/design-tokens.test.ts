import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrast, oklchToHex, over } from '../src/design/tokens/color'
import { moreContrastTokens, tokensCss } from '../src/design/tokens/css'
import { generateScale, SCALE_SPECS } from '../src/design/tokens/palette'
import { CHROME, FONT, RADIUS, STRETCH } from '../src/design/tokens/scales'
import { COLOR_SCHEMES, schemeColorRoles, schemeTokenDiff } from '../src/design/tokens/schemes'
import { colorRoles, surfaceColorRoles, WORKSPACE_TINT, type SurfaceStyle } from '../src/design/tokens/semantic'

const MODES = ['light', 'dark'] as const
const SURFACES: readonly SurfaceStyle[] = ['default', 'pure']

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

  it('adopts pure kepano/obsidian-minimal tokens, Inter typography, Slate Blue accent, and 8 official schemes (OXE-468)', () => {
    expect(SCALE_SPECS.neutral.hue).toBe(0)
    expect(SCALE_SPECS.neutral.chroma).toEqual({ light: 0, dark: 0 })
    // Retires Mandacaru caatinga (hue 158) and Sertão sun in favor of Minimal Slate Blue + amber.
    expect('caatinga' in SCALE_SPECS).toBe(false)
    expect('sun' in SCALE_SPECS).toBe(false)
    expect(SCALE_SPECS.slate.hue).toBe(235)
    expect(SCALE_SPECS.slate.chroma).toBeLessThanOrEqual(0.095)
    // Exact Minimal dark default & light default surface geometry.
    const darkDefault = surfaceColorRoles('dark', 'default')
    expect(darkDefault['surface-canvas']).toBe('#262626')
    expect(darkDefault['surface-chrome']).toBe('#212121')
    expect(darkDefault['surface-raised']).toBe('#2e2e2e')
    expect(darkDefault['surface-overlay']).toBe('#363636')
    expect(darkDefault['text-primary']).toBe('#d1d1d1')
    const lightDefault = surfaceColorRoles('light', 'default')
    expect(lightDefault['surface-canvas']).toBe('#ffffff')
    expect(lightDefault['surface-chrome']).toBe('#f5f5f5')
    // Inter typography with neutral 100% stretch (retires Instrument Sans condensed).
    expect(FONT.display).toContain("'Inter Variable'")
    expect(FONT.ui).toContain("'Inter Variable'")
    expect(FONT.display).not.toContain('Instrument Sans')
    expect(FONT.ui).not.toContain('Instrument Sans')
    expect(STRETCH).toEqual({ display: '100%', title: '100%' })
    expect(RADIUS).toEqual({ sm: '4px', md: '6px', lg: '8px', xl: '12px', full: '999px' })
    expect(CHROME['measure-prose']).toBe('44rem')
    expect(CHROME['measure-chat']).toBe('1080px')
    // All 8 official Minimal schemes present and emitted as compact diff-only CSS blocks.
    expect(COLOR_SCHEMES).toEqual(['default', 'obsidian', 'flexoki', 'nord', 'catppuccin', 'dracula', 'gruvbox', 'solarized'])
    const css = tokensCss()
    expect(css).toContain("[data-mode='light'][data-surface='pure']")
    expect(css).toContain("[data-mode='dark'][data-surface='pure']")
    expect(css).toContain('--measure-prose: 44rem;')
    for (const scheme of COLOR_SCHEMES) {
      if (scheme === 'default') continue
      expect(css).toContain(`[data-scheme='${scheme}'][data-mode='light']`)
      expect(css).toContain(`[data-scheme='${scheme}'][data-mode='dark']`)
      // Diff-only emission stays strictly smaller than a full role map.
      const diff = schemeTokenDiff(scheme, 'dark', 'default')
      expect(Object.keys(diff).length).toBeGreaterThan(0)
      expect(Object.keys(diff).length).toBeLessThan(Object.keys(darkDefault).length)
    }
  })

  for (const scheme of COLOR_SCHEMES) {
    for (const mode of MODES) {
      for (const surface of SURFACES) {
        describe(`${scheme} · ${mode} mode (${surface} surface)`, () => {
          const roles = schemeColorRoles(scheme, mode, surface)
          const surfaces = ['surface-canvas', 'surface-base', 'surface-raised', 'surface-overlay', 'surface-chrome', 'surface-sunken']

          it('keeps every text level AA (4.5:1) on every surface', () => {
            for (const text of ['text-primary', 'text-secondary', 'text-muted', 'text-accent', 'text-link']) {
              for (const surfaceRole of surfaces) expect.soft(contrast(roles[text], roles[surfaceRole]), `${text} on ${surfaceRole}`).toBeGreaterThanOrEqual(4.5)
            }
          })

          it('keeps text readable on selection and hover fills', () => {
            for (const fill of ['fill-hover', 'fill-pressed', 'fill-selected', 'fill-selected-strong', 'accent-soft']) {
              expect.soft(contrast(roles['text-primary'], roles[fill]), `text-primary on ${fill}`).toBeGreaterThanOrEqual(7)
              expect.soft(contrast(roles['text-secondary'], roles[fill]), `text-secondary on ${fill}`).toBeGreaterThanOrEqual(4.5)
            }
            for (const fill of ['fill-hover', 'fill-pressed', 'fill-selected', 'fill-selected-strong']) {
              expect.soft(contrast(roles['text-muted'], roles[fill]), `text-muted on ${fill}`).toBeGreaterThanOrEqual(4.5)
            }
          })

          it('labels on solid fills and intent colors are AA', () => {
            expect(contrast(roles['text-on-accent'], roles.accent)).toBeGreaterThanOrEqual(4.5)
            expect(contrast(roles['text-on-accent'], roles['accent-hover'])).toBeGreaterThanOrEqual(4.5)
            expect(contrast(roles['text-accent'], roles['accent-soft'])).toBeGreaterThanOrEqual(4.5)
            for (const solid of ['danger', 'success', 'info']) expect.soft(contrast(roles['text-on-solid'], roles[`intent-${solid}-solid`]), `label on ${solid} solid`).toBeGreaterThanOrEqual(4.5)
            expect.soft(contrast(roles['text-on-solid'], roles['intent-danger-solid-hover']), 'label on danger hover solid').toBeGreaterThanOrEqual(4.5)
            for (const intent of ['success', 'warning', 'danger', 'info']) {
              expect.soft(contrast(roles[`intent-${intent}-fg`], roles[`intent-${intent}-bg`]), `${intent} text on its background`).toBeGreaterThanOrEqual(4.5)
              expect.soft(contrast(roles[`intent-${intent}-fg`], roles['surface-raised']), `${intent} text on a raised surface`).toBeGreaterThanOrEqual(4.5)
            }
          })

          it('focus, control borders and status solids are visible against surfaces (3:1)', () => {
            for (const surfaceRole of ['surface-canvas', 'surface-base', 'surface-raised']) {
              expect.soft(contrast(roles['focus-ring'], roles[surfaceRole]), `focus on ${surfaceRole}`).toBeGreaterThanOrEqual(3)
              for (const intent of ['success', 'warning', 'danger', 'info']) expect.soft(contrast(roles[`intent-${intent}-solid`], roles[surfaceRole]), `${intent} solid on ${surfaceRole}`).toBeGreaterThanOrEqual(3)
            }
            for (const surfaceRole of ['surface-canvas', 'surface-raised']) {
              expect.soft(contrast(roles['border-control'], roles[surfaceRole]), `border-control on ${surfaceRole}`).toBeGreaterThanOrEqual(3)
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
            if (scheme === 'default') {
              // Warning orange (52°) sits well apart from Minimal Slate Blue (235°).
              expect(Math.abs(SCALE_SPECS.warning.hue - SCALE_SPECS.slate.hue)).toBeGreaterThanOrEqual(15)
            }
          })

          it('"needs you" (attn) stands apart from the accent and reads on every surface', () => {
            expect(roles.attn).not.toBe(roles.accent)
            for (const surfaceRole of surfaces) expect.soft(contrast(roles.attn, roles[surfaceRole]), `attn on ${surfaceRole}`).toBeGreaterThanOrEqual(3)
            expect(contrast(roles['attn-fg'], roles['attn-bg'])).toBeGreaterThanOrEqual(4.5)
            expect(contrast(roles['attn-fg'], roles['surface-raised'])).toBeGreaterThanOrEqual(4.5)
          })

          it('resource kinds and syntax colors are AA where they are read', () => {
            for (const name of ['file', 'db', 'box', 'net', 'shell']) {
              expect.soft(contrast(roles[`k-${name}-fg`], roles[`k-${name}-bg`]), `k-${name}-fg on its tint`).toBeGreaterThanOrEqual(4.5)
              expect.soft(contrast(roles[`k-${name}`], roles['surface-base']), `k-${name} mark`).toBeGreaterThanOrEqual(3)
            }
            for (const role of ['syn-kw', 'syn-str', 'syn-num', 'syn-fn', 'syn-type', 'syn-key', 'syn-cm', 'syn-pun', 'syn-var']) {
              for (const surfaceRole of ['surface-base', 'surface-sunken', 'surface-raised']) expect.soft(contrast(roles[role], roles[surfaceRole]), `${role} on ${surfaceRole}`).toBeGreaterThanOrEqual(4.5)
            }
            expect(contrast(roles['syn-var'], roles['syn-var-bg'])).toBeGreaterThanOrEqual(4.5)
            expect(contrast(roles['term-fg'], roles['term-bg'])).toBeGreaterThanOrEqual(7)
          })

          it('each workspace color marks at 3:1, and its text reads on its own tint (T85)', () => {
            for (let n = 1; n <= 8; n++) {
              const tint = over(roles[`ws-${n}`], WORKSPACE_TINT[mode], roles['surface-base'])
              expect.soft(contrast(roles[`ws-${n}`], roles['surface-base']), `ws-${n} mark`).toBeGreaterThanOrEqual(3)
              expect.soft(contrast(roles[`ws-${n}-fg`], tint), `ws-${n}-fg on its tint`).toBeGreaterThanOrEqual(4.5)
              expect.soft(contrast(roles[`ws-${n}-fg`], roles['fill-selected']), `ws-${n}-fg on a selected row`).toBeGreaterThanOrEqual(4.5)
            }
          })
        })
      }
    }
  }

  it('raises contrast when the system asks for more: borders take the strong step, muted text reads as secondary', () => {
    expect(tokensCss()).toContain('@media (prefers-contrast: more)')
    for (const mode of MODES) for (const surface of SURFACES) {
      const roles = colorRoles(mode, surface), more = moreContrastTokens(mode, surface)
      expect(more['border-subtle']).toBe(roles['border-strong'])
      expect(more['text-muted']).toBe(roles['text-secondary'])
      // Muted text gains contrast on every surface it sits on.
      for (const surfaceRole of ['surface-canvas', 'surface-base', 'surface-raised'] as const) expect(contrast(more['text-muted'], roles[surfaceRole])).toBeGreaterThan(contrast(roles['text-muted'], roles[surfaceRole]))
    }
  })

  it('composites overlays for contrast checks', () => {
    expect(over('#000000', 0.5, '#ffffff')).toBe('#808080')
  })
})
