/**
 * OxeVoice F1 · CR-03 (constraint from the coordinator) — frozen acceptance test (written by the plan, before
 * execution; do not edit). The voice renderer lints clean with zero warnings: in particular no ref writes during
 * render (`react-hooks/refs`).
 */
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

describe('voice renderer lint (CR-03)', () => {
  it('src/features/voice has zero ESLint errors and warnings', async () => {
    const eslint = new ESLint({ cwd: process.cwd() })
    const results = await eslint.lintFiles(['src/features/voice/**/*.{ts,tsx}'])
    const problems = results.flatMap(r => r.messages.map(m => `${r.filePath}:${m.line} ${m.ruleId ?? ''} ${m.message}`))
    expect(problems).toEqual([])
    expect(results.length).toBeGreaterThan(0)
  }, 120_000)
})
