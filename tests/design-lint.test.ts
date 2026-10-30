import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Design rules for CSS written on the new system: the primitives in src/ui and
 * every CSS Module. Colors, type sizes, radii and layers come from tokens.
 * A deliberate exception (a fixed preview of the other mode) sits between
 * `design-lint-disable` and `design-lint-enable` comments.
 * Legacy stylesheets join this check as they are migrated.
 */
const ROOT = join(__dirname, '..')

function files(dir: string, match: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path, match) : match(path) ? [path] : []
  })
}

const RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'color literal (use a --surface/--text/--border/--intent token)', pattern: /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/i },
  { name: 'pixel font size (use --text-*)', pattern: /font-size:\s*[\d.]+px/ },
  { name: 'numeric z-index (use --layer-*)', pattern: /z-index:\s*-?\d/ },
  { name: '!important', pattern: /!important/ },
  { name: 'pixel radius (use --radius-*)', pattern: /border-radius:\s*(?:[3-9]|\d\d+)px/ }
]

export function violations(css: string): Array<{ line: number; rule: string; text: string }> {
  const found: Array<{ line: number; rule: string; text: string }> = []
  let disabled = false
  css.split(/\r?\n/).forEach((text, index) => {
    if (text.includes('design-lint-disable')) disabled = true
    if (text.includes('design-lint-enable')) { disabled = false; return }
    if (disabled) return
    const code = text.replace(/\/\*.*?\*\//g, '')
    for (const rule of RULES) if (rule.pattern.test(code)) found.push({ line: index + 1, rule: rule.name, text: text.trim() })
  })
  return found
}

describe('design lint', () => {
  it('catches literal values and respects the exemption markers', () => {
    expect(violations('.a { color: #fff; font-size: 12px; z-index: 3; border-radius: 6px; }').map(item => item.rule)).toHaveLength(4)
    expect(violations('.a { color: var(--text-primary); border-radius: 50%; z-index: var(--layer-modal); }')).toEqual([])
    expect(violations('/* design-lint-disable */\n.a { color: #fff; }\n/* design-lint-enable */\n.b { color: red; }')).toEqual([])
  })

  it('new CSS (src/ui and CSS Modules) uses tokens only', () => {
    const targets = files(join(ROOT, 'src'), path => path.endsWith('.module.css'))
    expect(targets.length).toBeGreaterThan(0)
    const report = targets.flatMap(path => violations(readFileSync(path, 'utf8')).map(item => `${relative(ROOT, path)}:${item.line} ${item.rule} — ${item.text}`))
    expect(report).toEqual([])
  })

  describe('legacy stylesheets', () => {
    const legacy = files(join(ROOT, 'src'), path => path.endsWith('.css') && !path.endsWith('.module.css') && !/tokens\.generated|OxeQuery/.test(path))
    const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ''))
    const lines = (path: string): string[] => stripComments(readFileSync(path, 'utf8')).split(/\r?\n/)

    it('never pins a color scheme; the mode comes from the tokens', () => {
      const report = legacy.flatMap(path => lines(path).flatMap((text, index) => /color-scheme:\s*dark/.test(text) ? [`${relative(ROOT, path)}:${index + 1}`] : []))
      expect(report).toEqual([])
    })

    it('has no color literal outside shadows', () => {
      const report = legacy.flatMap(path => lines(path).flatMap((text, index) =>
        /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i.test(text) && !/shadow|--elevation/.test(text) ? [`${relative(ROOT, path)}:${index + 1} ${text.trim()}`] : []))
      expect(report).toEqual([])
    })

    it('does not add !important (ratchet: lower the number as they are removed)', () => {
      const count = legacy.reduce((sum, path) => sum + lines(path).filter(text => text.includes('!important')).length, 0)
      expect(count).toBeLessThanOrEqual(59)
    })

    it('stacks with the --layer-* scale, never a bare z-index number', () => {
      const report = legacy.flatMap(path => lines(path).flatMap((text, index) => /z-index:\s*-?\d/.test(text) ? [`${relative(ROOT, path)}:${index + 1} ${text.trim()}`] : []))
      expect(report).toEqual([])
    })
  })

  /**
   * Empty, loading and failed states come from src/ui (EmptyState, Skeleton, LoadingState, Spinner, ErrorState), so
   * every screen shows them the same way. These count what is still hand-made: lower each number as a screen moves
   * to the primitives; never raise it.
   */
  describe('states use the shared primitives (ratchet)', () => {
    const tsx = files(join(ROOT, 'src'), path => path.endsWith('.tsx') && !path.includes(`${join('src', 'ui')}`))
    const css = files(join(ROOT, 'src'), path => path.endsWith('.css') && !/tokens\.generated/.test(path))
    const count = (paths: string[], pattern: RegExp): number => paths.reduce((sum, path) => sum + (readFileSync(path, 'utf8').match(pattern)?.length ?? 0), 0)

    it('hand-made spinners (lucide Loader2) do not grow; use <Spinner>', () => {
      expect(count(tsx, /<Loader2\b/g)).toBeLessThanOrEqual(0)
    })
    it('the app has three keyframes, all in src/styles/motion.css: spin, shimmer and the brand pulse (docs/design/motion.md)', () => {
      const declared = css.flatMap(path => [...readFileSync(path, 'utf8').matchAll(/@keyframes\s+([\w:()-]+)/g)].map(match => `${relative(ROOT, path)} ${match[1]}`))
      expect(declared.map(entry => entry.replace(/\\/g, '/'))).toEqual(['src/styles/motion.css oxe-spin', 'src/styles/motion.css oxe-shimmer', 'src/styles/motion.css oxe-pulse'])
    })
    it('the keyframes animate only what the compositor moves cheaply: transform, scale, opacity and a background position', () => {
      const motion = readFileSync(join(ROOT, 'src', 'styles', 'motion.css'), 'utf8')
      const properties = [...motion.matchAll(/@keyframes[^{]+\{([^@]*?)\}\s*\}/g)].flatMap(match => [...match[1].matchAll(/([\w-]+)\s*:/g)].map(property => property[1]))
      expect(properties.length).toBeGreaterThan(0)
      expect(properties.filter(property => !['transform', 'scale', 'opacity', 'background-position'].includes(property))).toEqual([])
    })
    it('hand-made empty-state classes do not grow; use <EmptyState>', () => {
      expect(count(tsx, /className="[^"]*-empty\b[^"]*"/g)).toBeLessThanOrEqual(15)
    })
    it('alerts outside the primitives do not grow; use <ErrorState> or a field error', () => {
      expect(count(tsx, /role="alert"/g)).toBeLessThanOrEqual(31)
    })
    it('CSS modules time motion with the --duration tokens; fixed timings do not grow', () => {
      const modules = files(join(ROOT, 'src'), path => path.endsWith('.module.css'))
      const fixed = modules.reduce((sum, path) => sum + readFileSync(path, 'utf8').split(/\r?\n/)
        .filter(text => /(transition|animation)[^;]*\d+m?s\b/.test(text) && !text.includes('var(--duration')).length, 0)
      expect(fixed).toBeLessThanOrEqual(0)
    })
    it('legacy stylesheets time motion with the tokens too (only the reduced-motion reset in base.css is fixed)', () => {
      const legacy = css.filter(path => !path.endsWith('.module.css'))
      const fixed = legacy.flatMap(path => readFileSync(path, 'utf8').split(/\r?\n/)
        .filter(text => /(transition|animation)[^;]*\d+m?s\b/.test(text) && !text.includes('var(--duration')).map(text => `${relative(ROOT, path)}: ${text.trim()}`))
      expect(fixed.length).toBeLessThanOrEqual(2)
    })
    it('reduced motion is read from data-motion, so the Motion setting can override the operating system', () => {
      const report = css.flatMap(path => /prefers-reduced-motion/.test(readFileSync(path, 'utf8')) ? [relative(ROOT, path)] : [])
      expect(report).toEqual([])
    })
  })
})
