import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appIconSvg, ICON_SIZES, MARK_ARM_LEFT, MARK_ARM_LEFT_ORIGIN, MARK_ARM_RIGHT, MARK_ARM_RIGHT_ORIGIN, MARK_ON_TILE, MARK_TRUNK, TILE_RADIUS, TILE_SUN } from '../src/design/brand'
import { LOGO } from '../src/design/tokens/palette'
import { tokensCss } from '../src/design/tokens/css'

/**
 * The brand's touchpoints (docs/design/brand.md) all come from one source: the geometry in src/design/brand.ts and the
 * colors in the --logo-* tokens. These checks keep the logo, the icon files and the boot splash from drifting apart.
 */
const ROOT = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n')
const HEX = /#[0-9a-f]{3,8}\b/i

describe('brand touchpoints', () => {
  it('the logo, the loader and the splash name no color: they read the --logo-* and --brand-* tokens', () => {
    for (const path of ['src/components/Brand/OxeLogo.tsx', 'src/components/Brand/OxeLogo.module.css', 'src/ui/BrandLoader.tsx', 'src/ui/BrandLoader.module.css', 'src/styles/splash.css', 'index.html']) {
      expect(read(path), path).not.toMatch(HEX)
    }
    const css = tokensCss()
    for (const [name, value] of Object.entries(LOGO)) expect(css).toContain(`--logo-${name}: ${value};`)
  })

  it('resources/icon.svg is the generated app icon (run npm run generate:icon after changing the mark)', () => {
    expect(read('resources/icon.svg')).toBe(appIconSvg())
  })

  it('every desktop icon size is rendered at its size', () => {
    const width = (path: string): number => readFileSync(join(ROOT, path)).readUInt32BE(16)
    for (const size of ICON_SIZES) {
      const path = `resources/icons/${size}x${size}.png`
      expect(existsSync(join(ROOT, path)), path).toBe(true)
      expect(width(path), path).toBe(size)
    }
    expect(width('resources/icon.png')).toBe(512)
  })

  it('the boot splash draws the same mark as the logo, sprouting from the same points, and the window has a favicon', () => {
    const html = read('index.html')
    for (const part of [MARK_TRUNK, MARK_ARM_LEFT, MARK_ARM_RIGHT, MARK_ON_TILE, `rx="${TILE_RADIUS}"`, `cx="${TILE_SUN.cx}" cy="${TILE_SUN.cy}" r="${TILE_SUN.r}"`]) expect(html).toContain(part)
    expect(html).toMatch(/<div id="root"><div class="oxe-splash" role="status"/)
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/resources/icon.svg" />')
    const splash = read('src/styles/splash.css')
    expect(splash).toContain(`transform-origin: ${MARK_ARM_LEFT_ORIGIN};`)
    expect(splash).toContain(`transform-origin: ${MARK_ARM_RIGHT_ORIGIN};`)
    // The splash moves with the brand's keyframe, so it adds none of its own.
    expect(splash).not.toMatch(/@keyframes/)
  })
})
