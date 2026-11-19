// Acceptance test for 1.5.2 Polimento · OxeCode superfície (Jira OXE-257, PC-04·11, CA-3).
// SOURCE-TEXT check (marked): verifies the grid and pane stylesheets contain no radial-gradient and no
// box-shadow with a fixed rgba() color.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const FILES = [
  'src/styles/layout.css',
  'src/styles/split-grid.css',
  'src/styles/features/status.css',
  'src/styles/features/pane.css'
]

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('PC-04·11 · flat brand surfaces in grid and pane CSS', () => {
  test('the grid and pane CSS has no radial-gradient and no box-shadow with a fixed rgba (source text, marked)', () => {
    const radialViolations: string[] = []
    const rgbaShadowViolations: string[] = []

    for (const rel of FILES) {
      const text = stripComments(readFileSync(join(process.cwd(), rel), 'utf8'))
      if (/radial-gradient\s*\(/i.test(text)) {
        radialViolations.push(rel)
      }
      for (const match of text.matchAll(/box-shadow\s*:[^;{}]*rgba\s*\([^;{}]*/gi)) {
        rgbaShadowViolations.push(`${rel}: ${match[0].trim()}`)
      }
    }

    expect(radialViolations).toEqual([])
    expect(rgbaShadowViolations).toEqual([])
  })
})
