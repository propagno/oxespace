import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = process.cwd()

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function ruleBodiesFor(css: string, selectorMatch: RegExp): string[] {
  const bodies: string[] = []
  const clean = stripComments(css)
  for (const match of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = match[1].trim()
    if (selectorMatch.test(selector)) {
      bodies.push(match[2])
    }
  }
  return bodies
}

describe('OXE-451 A4 · Zero CSS layout geometry transitions on terminal containers', () => {
  test('.app-shell snaps sidebar columns in 1 frame with no grid-template-columns transition', () => {
    const baseCss = readFileSync(resolve(ROOT, 'src/styles/base.css'), 'utf8')
    const appShellBodies = ruleBodiesFor(baseCss, /(^|,)\s*\.app-shell\s*($|,)/)
    expect(appShellBodies.length).toBeGreaterThan(0)

    const combined = appShellBodies.join('\n')
    expect(combined).toMatch(/display:\s*grid/)
    expect(combined).toMatch(/grid-template-columns:\s*var\(--sidebar-w\)\s+minmax\(0,\s*1fr\)/)
    expect(combined).not.toMatch(/transition\s*:[^;]*(grid-template-columns|width|height|\ball\b)/i)

    const collapsedBodies = ruleBodiesFor(baseCss, /\.app-shell\.sidebar-collapsed\b/)
    expect(collapsedBodies.join('\n')).toMatch(/grid-template-columns:\s*var\(--sidebar-w-collapsed\)\s+minmax\(0,\s*1fr\)/)
  })

  test('workspace and terminal layout containers declare no width/height/grid CSS transitions', () => {
    const files = [
      'src/styles/base.css',
      'src/styles/layout.css',
      'src/styles/split-grid.css',
      'src/styles/features/terminal.css'
    ]
    const containerSelector =
      /(^|,)\s*\.(app-shell|workspace-surface|workspace-host|workspace-surface-content|workspace-split-grid|split-pane-slot|terminal-pane|terminal-content)(\b|$)/
    const geometryTransition = /transition\s*:[^;]*(grid-template|(?<![a-z-])width|(?<![a-z-])height|(?<![a-z-])flex|\ball\b)/i

    const offenders: string[] = []
    for (const rel of files) {
      const css = readFileSync(resolve(ROOT, rel), 'utf8')
      const clean = stripComments(css)
      for (const match of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selector = match[1].trim()
        const body = match[2]
        // Ignore decorative pseudo-elements (::before / ::after).
        if (/::?(?:before|after)\b/.test(selector)) continue
        if (containerSelector.test(selector) && geometryTransition.test(body)) {
          offenders.push(`${rel}: ${selector}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('TerminalView.tsx stays within check-file-size 1000-line ceiling', () => {
    const src = readFileSync(resolve(ROOT, 'src/components/Terminal/TerminalView.tsx'), 'utf8')
    const lines = src.length === 0 ? 0 : src.split('\n').length - (src.endsWith('\n') ? 1 : 0)
    expect(lines).toBeLessThanOrEqual(1000)
  })
})
