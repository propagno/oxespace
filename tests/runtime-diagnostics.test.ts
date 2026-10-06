// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { RuntimeDiagnostics, diagnosticId } from '../electron/main/services/runtime-diagnostics'

const roots: string[] = []
function fixture() { const root = mkdtempSync(join(tmpdir(), 'oxe-diagnostics-')); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) {
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw Error('Unsafe cleanup')
  rmSync(root, { recursive: true, force: true })
} })

it('does not retain arbitrary content, paths, arguments or credentials', () => {
  const recorder = new RuntimeDiagnostics(fixture())
  const unsafe = { thread: 'private-project', executable: '/home/person/claude', state: 'secret-state', kind: 'secret-kind', prompt: 'private prompt', token: 'secret-token', args: '--password=secret', output: 'private file' }
  recorder.record('process-start', unsafe)
  const output = recorder.export()
  for (const value of ['private-project', '/home/person', 'secret-state', 'secret-kind', 'private prompt', 'secret-token', '--password', 'private file']) expect(output).not.toContain(value)
  expect(output).toContain(diagnosticId('private-project'))
  expect(output).toContain('"executable":"claude"')
})

it('summarizes a flood and bounds distinct events without losing the suppression count', () => {
  const recorder = new RuntimeDiagnostics(fixture())
  for (let i = 0; i < 10000; i++) recorder.record('child-gone', { kind: 'GPU', state: 'launch-failed' })
  for (let i = 0; i < 1000; i++) recorder.record('tool', { task: String(i), state: 'running' })
  const rows = recorder.export().trim().split('\n').map(line => JSON.parse(line))
  expect(rows.length).toBeLessThanOrEqual(122)
  expect(rows).toContainEqual(expect.objectContaining({ event: 'child-gone', repeats: 9999 }))
  expect(rows).toContainEqual(expect.objectContaining({ event: 'rate-limited', count: 881 }))
})

it('rotates within the three-file budget and keeps recent records across restart', () => {
  const root = fixture(); let now = Date.now()
  const recorder = new RuntimeDiagnostics(root, () => now, 1024)
  for (let i = 0; i < 200; i++) { now += 60001; recorder.record('process-start', { pid: i }) }
  recorder.flush()
  const files = readdirSync(root)
  expect(files).toHaveLength(3)
  expect(files.reduce((sum, file) => sum + statSync(join(root, file)).size, 0)).toBeLessThanOrEqual(3072)
  const next = new RuntimeDiagnostics(root, () => now, 1024)
  expect(next.export()).toContain('"pid":199')
  expect(next.export()).not.toContain('"pid":0,')
})

it('expires old records even when their file has a recent modification time', () => {
  const root = fixture(), now = Date.now()
  writeFileSync(join(root, 'runtime.0.jsonl'), JSON.stringify({ at: now - 8 * 86400_000, event: 'old' }) + '\n' + JSON.stringify({ at: now, event: 'recent' }) + '\n')
  const recorder = new RuntimeDiagnostics(root, () => now)
  expect(recorder.export()).not.toContain('old')
  expect(readFileSync(join(root, 'runtime.0.jsonl'), 'utf8')).toContain('recent')
})

it('fails closed when storage becomes unavailable instead of breaking execution or retrying logs', () => {
  const root = fixture(), recorder = new RuntimeDiagnostics(root)
  // Make the current log destination unusable without changing filesystem permissions.
  writeFileSync(join(root, 'runtime.0.jsonl'), '')
  rmSync(join(root, 'runtime.0.jsonl'))
  rmdirSync(root) // empty, verified fixture directory; not recursive
  writeFileSync(root, 'not a directory')
  expect(() => recorder.record('process-start', { pid: 1 })).not.toThrow()
  expect(recorder.available).toBe(false)
  expect(() => recorder.flush()).not.toThrow()
  expect(readFileSync(root, 'utf8')).toBe('not a directory')
})
