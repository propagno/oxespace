// Frozen acceptance test for the 1.5.0 F2 dependency PR, R-deps (owner SRE, plan .claude/roadmap-1.4/team/plans/f2-deps-SRE.json).
// Written by the planner; the executor must not edit it. Static checks only. It fails until R1–R5 and R-deps have merged.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

const PACKAGES = ['@xenova/transformers', 'onnxruntime-node', 'onnxruntime-web', 'sharp', 'codegraph']
const OVERRIDES = ['sharp', 'protobufjs']
const SCRIPTS_GONE = [
  'scripts/fetch-semantic-model.mjs',
  'scripts/semantic-eval.mjs',
  'scripts/semantic-lab.mjs',
  'scripts/semantic-quality-gate.mjs',
  'scripts/hybrid-eval.ts',
  'scripts/decision-quality-eval.ts',
  'scripts/token-reduction-bench.mjs',
  'scripts/test-memory-compatibility.mjs',
]
const NO_MENTION = /@xenova\/transformers|onnxruntime|\bsharp\b/

describe('R-deps · the final F2 dependency PR', () => {
  test('R-deps: package.json no longer declares the removed packages, nor overrides them', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, Record<string, string> | undefined>
    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }
    expect(PACKAGES.filter(name => name in all)).toEqual([])
    expect(OVERRIDES.filter(name => name in (pkg.overrides ?? {}))).toEqual([])
    expect(['web-tree-sitter', 'tree-sitter-wasms'].filter(name => !(name in all))).toEqual([])
  })

  test('R-deps: package-lock.json has none of the removed packages', () => {
    const lock = JSON.parse(read('package-lock.json')) as { packages?: Record<string, unknown> }
    const paths = Object.keys(lock.packages ?? {})
    const offenders = paths.filter(path => PACKAGES.some(name => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`)))
    expect(offenders).toEqual([])
  })

  test('R-deps: no npm script runs a removed script, and the removed scripts are gone', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts?: Record<string, string> }).scripts ?? {}
    const names = SCRIPTS_GONE.map(path => path.replace(/^scripts\//, ''))
    const offenders = Object.entries(scripts).filter(([, command]) => names.some(name => command.includes(name))).map(([name]) => name)
    expect(offenders).toEqual([])
    expect(SCRIPTS_GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])
  })

  test('R-deps: electron-builder.yml, slim-pack-deps.mjs and the workflows no longer name transformers, ONNX or sharp', () => {
    const files = ['electron-builder.yml', 'scripts/slim-pack-deps.mjs', '.github/workflows/ci.yml', '.github/workflows/install-over.yml']
    expect(files.filter(file => existsSync(join(ROOT, file)) && NO_MENTION.test(read(file)))).toEqual([])
  })

  test('R-deps: bundled-dependencies.mjs no longer lists codegraph, and file-size-baseline.json lists only files that exist', () => {
    expect(read('scripts/bundled-dependencies.mjs')).not.toMatch(/name:\s*['"]codegraph['"]/)
    const baseline = JSON.parse(read('scripts/file-size-baseline.json')) as Record<string, number>
    expect(Object.keys(baseline).filter(file => !existsSync(join(ROOT, file)))).toEqual([])
  })
})
