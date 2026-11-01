/**
 * Monaco's input-latency sampler (monaco-editor's vs/base/browser/performance.js) measures each keystroke and reads
 * `performance.getEntriesByName(name)[0].duration` right after. Now and then the entry is not there and the editor's
 * keydown/keyup handlers throw "Cannot read properties of undefined (reading 'duration')" as an uncaught page error
 * (seen in e2e/close-guard.spec.ts on Linux and Windows). The sample is only Monaco's own statistics, so a missing one
 * is skipped. The build fails if the line is not found, so a Monaco upgrade makes us look again.
 */
export const MONACO_PERFORMANCE_MODULE = /monaco-editor[\\/]esm[\\/]vs[\\/]base[\\/]browser[\\/]performance\.js$/
const UNGUARDED = 'const duration = performance.getEntriesByName(entryName)[0].duration;'
const GUARDED = 'const entry = performance.getEntriesByName(entryName)[0]; if (!entry) { return; } const duration = entry.duration;'

/** The guarded source, or an error when Monaco's code changed and the guard needs a fresh look. */
export function guardMonacoInputLatency(code, id = 'vs/base/browser/performance.js') {
  if (code.includes(GUARDED)) return code
  if (!code.includes(UNGUARDED)) throw new Error(`monaco-input-latency-guard: the addMeasure line was not found in ${id}; Monaco changed, check whether the guard is still needed`)
  return code.replace(UNGUARDED, GUARDED)
}

/** Vite plugin: applies the guard to Monaco's performance module, in dev and in builds. */
export function monacoInputLatencyGuard() {
  return {
    name: 'monaco-input-latency-guard',
    enforce: 'pre',
    transform(code, id) {
      if (!MONACO_PERFORMANCE_MODULE.test(id.split('?')[0])) return null
      return { code: guardMonacoInputLatency(code, id), map: null }
    }
  }
}
