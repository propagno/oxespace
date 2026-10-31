import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isPublishedBuild } from '../src/lib/buildKind'

/**
 * The boot script (public/boot-appearance.js, loaded from index.html) applies the saved light/dark and motion before the first paint (the splash), so the
 * window never flashes the other mode (homologation R1). It must read exactly what src/design/mode.ts and motion.ts
 * write: this runs the script itself.
 */
const ROOT = join(__dirname, '..')
const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
const script = readFileSync(join(ROOT, 'public', 'boot-appearance.js'), 'utf8')
const run = (): void => { new Function(script)() }

afterEach(() => { localStorage.clear(); delete document.documentElement.dataset.mode; delete document.documentElement.dataset.motion })

describe('boot appearance', () => {
  it('runs before the app script and uses the same settings key as mode.ts and motion.ts', () => {
    expect(script).not.toBe('')
    // A classic script in the head, before the app's module: it runs before the first paint.
    expect(html).toMatch(/<head>[\s\S]*<script src="\/boot-appearance\.js"><\/script>[\s\S]*<\/head>/)
    expect(html.indexOf('boot-appearance.js')).toBeLessThan(html.indexOf('src="/src/main.tsx"'))
    for (const file of ['src/design/mode.ts', 'src/design/motion.ts']) expect(readFileSync(join(ROOT, file), 'utf8')).toContain("const SETTINGS_KEY = 'oxe-settings'")
    expect(script).toContain("localStorage.getItem('oxe-settings')")
  })

  it('applies a chosen Dark or Light and Reduced or Full motion', () => {
    localStorage.setItem('oxe-settings', JSON.stringify({ state: { appearance: 'dark', motion: 'reduce' }, version: 6 }))
    run()
    expect(document.documentElement.dataset.mode).toBe('dark')
    expect(document.documentElement.dataset.motion).toBe('reduce')
  })

  it('leaves System to the stylesheet, and survives missing or broken settings', () => {
    localStorage.setItem('oxe-settings', JSON.stringify({ state: { appearance: 'system', motion: 'system' } }))
    run()
    expect(document.documentElement.dataset.mode).toBeUndefined()
    localStorage.setItem('oxe-settings', '{not json')
    expect(run).not.toThrow()
    expect(document.documentElement.dataset.motion).toBeUndefined()
  })
})

describe('published build', () => {
  it('is the renderer loaded from inside app.asar, never a dev server or the e2e build', () => {
    expect(isPublishedBuild('file:///C:/Program%20Files/OXESpace/resources/app.asar/out/renderer/index.html')).toBe(true)
    expect(isPublishedBuild('file:///opt/OXESpace/resources/app.asar/out/renderer/index.html')).toBe(true)
    expect(isPublishedBuild('http://localhost:5173/')).toBe(false)
    expect(isPublishedBuild('file:///C:/repo/out/renderer/index.html')).toBe(false)
  })
})
