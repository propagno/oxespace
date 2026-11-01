import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MONACO_PERFORMANCE_MODULE, guardMonacoInputLatency, monacoInputLatencyGuard } from '../../scripts/monaco-input-latency-guard.mjs'

const MODULE = join(process.cwd(), 'node_modules', 'monaco-editor', 'esm', 'vs', 'base', 'browser', 'performance.js')

describe('the Monaco input-latency guard (close-guard pageerror)', () => {
  it('guards the installed Monaco: a sample whose entry is gone is skipped instead of throwing', () => {
    const guarded = guardMonacoInputLatency(readFileSync(MODULE, 'utf8'))
    expect(guarded).toContain('if (!entry) { return; }')
    expect(guarded).not.toContain('getEntriesByName(entryName)[0].duration')
    // Applying it twice changes nothing.
    expect(guardMonacoInputLatency(guarded)).toBe(guarded)
  })

  it('the guarded addMeasure survives a missing entry and still counts a present one', () => {
    const source = guardMonacoInputLatency('function addMeasure(entryName, cumulativeMeasurement) {\n        const duration = performance.getEntriesByName(entryName)[0].duration;\n        cumulativeMeasurement.total += duration;\n    }\n    return addMeasure;')
    const entries: Record<string, Array<{ duration: number }>> = { keydown: [{ duration: 4 }] }
    const addMeasure = new Function('performance', source)({ getEntriesByName: (name: string) => entries[name] ?? [] }) as (name: string, total: { total: number }) => void
    const total = { total: 0 }
    expect(() => addMeasure('input', total)).not.toThrow()
    addMeasure('keydown', total)
    expect(total.total).toBe(4)
  })

  it('fails the build when Monaco changed, so the guard is looked at again', () => {
    expect(() => guardMonacoInputLatency('const nothing = 1;')).toThrow(/Monaco changed/)
  })

  it('is a Vite plugin for that one module only', () => {
    const plugin = monacoInputLatencyGuard()
    expect(plugin.transform('const x = 1', '/repo/src/App.tsx')).toBeNull()
    expect(MONACO_PERFORMANCE_MODULE.test('C:\\repo\\node_modules\\monaco-editor\\esm\\vs\\base\\browser\\performance.js')).toBe(true)
    expect(MONACO_PERFORMANCE_MODULE.test('/repo/node_modules/monaco-editor/esm/vs/base/browser/performance.js')).toBe(true)
  })
})
