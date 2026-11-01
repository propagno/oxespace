import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * B13 (BE-M-02): the packaged app ships with the RunAsNode fuse off, so no runtime code may run the app binary as
 * Node. This guards the source; scripts/check-bundle-imports.mjs guards the built bundle the same way, and CI reads
 * the fuses of the packaged binary (scripts/check-fuses.mjs). Dev and test scripts (scripts/, tests/, e2e/) may still
 * use ELECTRON_RUN_AS_NODE with the unpackaged electron binary: fuses only apply to the packaged one.
 */
const root = process.cwd()
const RUNTIME = ['electron', 'shared', 'src', 'resources']

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path)
    return /\.(ts|tsx|js|cjs|mjs)$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : []
  })
}

const files = RUNTIME.flatMap(dir => sources(join(root, dir))).map(path => ({ path: relative(root, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }))
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')

/** Sites that name process.execPath as a child to spawn, each with the Electron guard that keeps it from running. */
const GUARDED_EXEC_PATH = new Map([
  ['electron/main/vendor/codegraph/mcp/index.ts', 'if (process.versions.electron) throw'],
  ['electron/main/vendor/codegraph/extraction/wasm-runtime-flags.ts', 'if (process.versions.electron) return']
])

describe('no runtime code runs the app binary as Node (RunAsNode fuse off)', () => {
  it('scans the runtime sources', () => {
    expect(files.length).toBeGreaterThan(500)
    expect(files.some(file => file.path === 'electron/main/services/conversation/process-transport.ts')).toBe(true)
  })

  it('never sets ELECTRON_RUN_AS_NODE (deleting it from a child env is fine)', () => {
    const setters = files.filter(file => /ELECTRON_RUN_AS_NODE['"`]?\s*(?::|=(?!=))/.test(code(file.text))).map(file => file.path)
    expect(setters).toEqual([])
  })

  it('never uses child_process.fork, which Electron runs as process.execPath plus ELECTRON_RUN_AS_NODE', () => {
    const forks = files.filter(file => {
      const text = code(file.text)
      return /import\s*\{[^}]*\bfork\b[^}]*\}\s*from\s*['"](?:node:)?child_process['"]/.test(text) ||
        /(?:child_process|require\(\s*['"](?:node:)?child_process['"]\s*\))\s*\.\s*fork\s*\(/.test(text)
    }).map(file => file.path)
    expect(forks).toEqual([])
  })

  it('spawns process.execPath only where an Electron guard stops it first', () => {
    const spawning = files.filter(file => /\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(\s*process\.execPath\b/.test(code(file.text)) ||
      /\(\s*\n\s*process\.execPath\s*,/.test(code(file.text))).map(file => file.path)
    expect(spawning.sort()).toEqual([...GUARDED_EXEC_PATH.keys()].sort())
    for (const [path, guard] of GUARDED_EXEC_PATH) expect(files.find(file => file.path === path)?.text, path).toContain(guard)
  })

  it('the app does not bundle the CodeGraph MCP server, whose daemon spawns process.execPath', () => {
    const index = files.find(file => file.path === 'electron/main/vendor/codegraph/index.ts')!
    expect(code(index.text)).not.toMatch(/export\s*\{[^}]*\bMCPServer\b/)
  })

  it('electron-builder.yml asks for the B13 fuses, and check-fuses.mjs expects the same', () => {
    const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
    const fuses = yml.slice(yml.indexOf('electronFuses:'))
    const lines = fuses.split(/\r?\n/).slice(1)
    const block = lines.slice(0, lines.findIndex(line => !/^ {2}\w/.test(line)))
    expect(Object.fromEntries(block.map(line => line.trim().split(/:\s*/)))).toEqual({
      runAsNode: 'false',
      enableNodeOptionsEnvironmentVariable: 'false',
      enableNodeCliInspectArguments: 'true',
      enableEmbeddedAsarIntegrityValidation: 'true',
      onlyLoadAppFromAsar: 'true'
    })
    const checker = readFileSync(join(root, 'scripts', 'check-fuses.mjs'), 'utf8')
    for (const expected of ['RunAsNode: false', 'EnableNodeOptionsEnvironmentVariable: false', 'EnableNodeCliInspectArguments: true',
      'EnableEmbeddedAsarIntegrityValidation: true', 'OnlyLoadAppFromAsar: true']) expect(checker).toContain(expected)
  })
})
