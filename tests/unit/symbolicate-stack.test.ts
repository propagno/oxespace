// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { transform } from 'esbuild'
// @ts-expect-error -- a plain ES module script without type declarations
import { decodeMappings, mapLoader, originalPosition, parseSourceMap, symbolicateStack } from '../../scripts/symbolicate-stack.mjs'

const SOURCE = [
  'export class ReportProblem extends Error {',
  '  constructor(message: string) { super(message); this.name = "ReportProblem" }',
  '}',
  '',
  'export function buildReport(input: { title?: string }): string {',
  '  const title = input.title ?? ""',
  '  if (!title.trim()) throw new ReportProblem("The report has no title.")',
  '  return title',
  '}',
  ''
].join('\n')

const temp = mkdtempSync(join(tmpdir(), 'oxespace-symbolicate-'))
afterAll(() => rmSync(temp, { recursive: true, force: true }))

/** Minifies the fixture the way the build does, writes it as out/main/chunks/report-x.js with a hidden map, and runs it. */
async function minifiedStack(): Promise<{ stack: string, outMain: string, code: string }> {
  const result = await transform(SOURCE, { loader: 'ts', format: 'cjs', minify: true, keepNames: true, sourcemap: 'external', sourcefile: 'report.ts' })
  const outMain = join(temp, 'out', 'main')
  mkdirSync(join(outMain, 'chunks'), { recursive: true })
  writeFileSync(join(temp, 'package.json'), '{"type":"commonjs"}')
  const map = JSON.parse(result.map)
  map.sources = ['../../../electron/main/services/report.ts']
  writeFileSync(join(outMain, 'chunks', 'report-x.js'), result.code)
  writeFileSync(join(outMain, 'chunks', 'report-x.js.map'), JSON.stringify(map))
  writeFileSync(join(outMain, 'index.js.map'), JSON.stringify({ version: 3, sources: [], names: [], mappings: '' }))
  // A plain Node process prints the stack V8 builds; the test runner rewrites stack traces in its own process.
  const runner = join(temp, 'run.js')
  writeFileSync(runner, 'try { require("./out/main/chunks/report-x.js").buildReport({}) } catch (error) { process.stdout.write(error.stack) }')
  const stack = execFileSync(process.execPath, [runner], { encoding: 'utf8' })
  if (!stack) throw new Error('the fixture did not throw')
  return { stack, outMain, code: result.code }
}

describe('symbolicate-stack', () => {
  it('has no shebang, so the test runner can import it when Windows checks it out with CRLF', () => {
    expect(readFileSync(join('scripts', 'symbolicate-stack.mjs'), 'utf8').startsWith('#!')).toBe(false)
  })

  it('maps a real minified stack frame back to the source line, keeping names and untouched frames', async () => {
    const { stack, outMain, code } = await minifiedStack()
    expect(code).not.toContain('sourceMappingURL')
    // keepNames: the error class and function keep their names after minification.
    expect(stack).toMatch(/^ReportProblem: The report has no title\./)
    expect(stack).toMatch(/at (?:Object.)?buildReport \(.*out[\\/]main[\\/]chunks[\\/]report-x\.js:\d+:\d+\)/)
    const { text, mapped } = symbolicateStack(stack, mapLoader(outMain))
    expect(mapped).toBeGreaterThanOrEqual(1)
    expect(text).toMatch(/at (?:Object.)?buildReport \(electron\/main\/services\/report\.ts:7:\d+\)/)
    // Frames outside the main bundle are left as they were.
    expect(text.split('\n').filter(line => line.includes('node:internal'))).toEqual(stack.split('\n').filter(line => line.includes('node:internal')))
  })

  it('handles a packaged Windows path with spaces, a file:// URL and a chunk without a map', () => {
    const map = parseSourceMap(JSON.stringify({ version: 3, sources: ['../../electron/main/index.ts'], names: ['start'], mappings: 'AAAA,UAAUA' }))
    const loader = (chunk: string) => chunk === 'index.js' ? map : null
    const input = [
      'Error: x',
      String.raw`    at start (C:\Program Files\OXESpace\resources\app.asar\out\main\index.js:1:11)`,
      '    at file:///opt/OXESpace/resources/app.asar/out/main/index.js:1:3',
      String.raw`    at %USERPROFILE%\app\out\main\chunks\gone-1.js:4:2`
    ].join('\n')
    const { text, mapped, unmapped } = symbolicateStack(input, loader)
    expect(text.split('\n')).toEqual([
      'Error: x',
      '    at start (electron/main/index.ts:1:11)',
      '    at electron/main/index.ts:1:1',
      String.raw`    at %USERPROFILE%\app\out\main\chunks\gone-1.js:4:2`
    ])
    expect([mapped, unmapped]).toEqual([2, 1])
  })

  it('decodes VLQ mappings with relative fields across lines and segments', () => {
    // Line 1: [0,0,0,0] and [10,0,0,10,0]; line 2 empty; line 3: [2,0,1,10] (source line and column carry over).
    expect(decodeMappings('AAAA,UAAUA;;EACA')).toEqual([[[0, 0, 0, 0], [10, 0, 0, 10, 0]], [], [[2, 0, 1, 10]]])
    expect(decodeMappings('D')).toEqual([[[-1]]])
    const map = parseSourceMap(JSON.stringify({ version: 3, sources: ['a.ts'], names: ['go'], mappings: 'AAAA,UAAUA;;EACA' }))
    expect(originalPosition(map, 1, 15)).toEqual({ source: 'a.ts', line: 1, column: 11, name: 'go' })
    expect(originalPosition(map, 3, 1)).toBeNull()
    expect(originalPosition(map, 3, 3)).toEqual({ source: 'a.ts', line: 2, column: 11, name: null })
  })

  it('rejects input that is not a usable source map or position', () => {
    expect(() => parseSourceMap('not json')).toThrow(/not JSON/)
    expect(() => parseSourceMap(JSON.stringify({ version: 2, sources: [], mappings: '' }))).toThrow(/version 3/)
    expect(() => parseSourceMap(JSON.stringify({ version: 3, mappings: '' }))).toThrow(/sources/)
    expect(() => decodeMappings('AA!A')).toThrow(/not a base64 VLQ digit/)
    expect(() => decodeMappings('g')).toThrow(/cut short/)
    expect(() => decodeMappings('AA')).toThrow(/2 fields/)
    expect(() => decodeMappings('gggggggggA')).toThrow(/too long/)
    const map = parseSourceMap(JSON.stringify({ version: 3, sources: ['a.ts'], mappings: 'AAAA' }))
    expect(originalPosition(map, 0, 1)).toBeNull()
    expect(originalPosition(map, 1, 0)).toBeNull()
    expect(originalPosition(map, 9, 1)).toBeNull()
    expect(originalPosition(map, 1.5, 1)).toBeNull()
  })

  it('never reads a map outside the build folder', () => {
    const outMain = join(temp, 'guard', 'out', 'main')
    mkdirSync(outMain, { recursive: true })
    writeFileSync(join(temp, 'guard', 'secret.js.map'), JSON.stringify({ version: 3, sources: ['x'], mappings: 'AAAA' }))
    expect(mapLoader(outMain)('../../secret.js')).toBeNull()
    expect(mapLoader(outMain)('index.js')).toBeNull()
  })
})
