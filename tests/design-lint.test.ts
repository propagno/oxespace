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
})
