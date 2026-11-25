// @vitest-environment node
// OXE-303: e2e/ had no typecheck at all (tsconfig.json covers electron/, src/ and shared/ only), so a wrong type in a
// spec or helper surfaced as a runtime failure on CI, if ever. tsconfig.e2e.json covers e2e/**/*.ts under strict, and
// `npm run typecheck` (the Quick checks job) runs it. e2e/acceptance/** stays out: frozen specs, a card of its own.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function e2eConfig(): ts.ParsedCommandLine {
  const file = join(root, 'tsconfig.e2e.json')
  const read = ts.readConfigFile(file, ts.sys.readFile)
  expect(read.error, 'tsconfig.e2e.json parses').toBeUndefined()
  return ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, file)
}

describe('OXE-303: e2e under the strict typecheck', () => {
  it('tsconfig.e2e.json covers e2e specs and compiles cleanly under strict typecheck', () => {
    const config = e2eConfig()
    expect(config.errors).toEqual([])
    expect(config.options.strict).toBe(true)
    expect(config.options.noEmit).toBe(true)
    const files = config.fileNames.map(name => name.replace(/\\/g, '/').slice(root.replace(/\\/g, '/').length + 1))
    // Every spec and helper of e2e/, except the frozen acceptance specs.
    for (const expected of ['e2e/perf-benchmark.spec.ts', 'e2e/helpers/thread-fixtures.ts', 'e2e/memory-footprint.spec.ts', 'e2e/helpers/launch.ts']) expect(files).toContain(expected)
    expect(files.filter(name => name.startsWith('e2e/acceptance/'))).toEqual([])
    const program = ts.createProgram({ rootNames: config.fileNames, options: config.options })
    const errors = ts.getPreEmitDiagnostics(program).map(diagnostic => {
      const where = diagnostic.file ? `${diagnostic.file.fileName.replace(/\\/g, '/').split('/e2e/').pop()}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}` : ''
      return `${where} TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`
    })
    expect(errors).toEqual([])
  }, 180_000)

  it('typecheck script invokes tsconfig.e2e.json', () => {
    const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts
    expect(scripts.typecheck).toMatch(/tsc --noEmit -p tsconfig\.json/)
    expect(scripts.typecheck).toMatch(/tsc --noEmit -p tsconfig\.e2e\.json/)
    // Quick checks runs that script.
    expect(readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')).toMatch(/run: npm run typecheck/)
  })
})
