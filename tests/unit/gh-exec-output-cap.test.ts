// @vitest-environment node
/**
 * CR-F4-5b (A60, TECH LEAD 09/11): gh's output for the pull request provider is capped, as P9's runner capped it, so a
 * large PR diff or log never grows the main process's memory without bound. The spawn keeps at most maxOutputBytes
 * per stream as the output arrives; GhExec.ghCommand asks for GH_OUTPUT_CAP. A real child process for the cap; a fake
 * spawner for ghCommand, whose git config read goes through the same spawner, so no real git or gh runs.
 */
import { tmpdir } from 'node:os'
import { describe, expect, test, vi } from 'vitest'
import { defaultSpawnAsync, GH_OUTPUT_CAP, GhExec, type SpawnAsyncFn, type SpawnAsyncOptions } from '../../electron/main/services/github/gh-exec'

vi.setConfig({ testTimeout: 60_000 })
const MIB = 1024 * 1024
/** A child that writes `size` characters to stdout and to stderr. */
const writer = (size: number): string[] => ['-e', `const s='x'.repeat(${size});process.stdout.write(s);process.stderr.write(s)`]

describe('gh output cap (CR-F4-5b)', () => {
  test('the cap is P9\'s 8 MiB', () => {
    expect(GH_OUTPUT_CAP).toBe(8 * MIB)
  })

  test('the spawn keeps at most maxOutputBytes of each stream, and the whole output without a cap', async () => {
    const size = 3 * MIB
    // The path is live: without a cap the whole output arrives.
    const whole = await defaultSpawnAsync(process.execPath, writer(size), { cwd: tmpdir(), timeout: 30_000 })
    expect(whole.status).toBe(0)
    expect(whole.stdout.length).toBe(size)
    const capped = await defaultSpawnAsync(process.execPath, writer(size), { cwd: tmpdir(), timeout: 30_000, maxOutputBytes: MIB })
    expect(capped.status).toBe(0)
    expect(capped.stdout.length).toBe(MIB)
    expect(capped.stderr.length).toBe(MIB)
    expect(capped.stdout).toBe('x'.repeat(MIB))
  })

  test('ghCommand asks the spawn for GH_OUTPUT_CAP on gh, and keeps its exit status', async () => {
    const calls: Array<{ command: string; options: SpawnAsyncOptions }> = []
    const spawnCommand: SpawnAsyncFn = async (command, args, options) => {
      calls.push({ command, options })
      // The repository config read (git config) answers with nothing; gh answers "no pull request".
      if (args.includes('config')) return { stdout: '', stderr: '', status: 0 }
      return { stdout: '', stderr: 'no pull requests found', status: 1 }
    }
    const reply = await new GhExec({ spawnCommand }).ghCommand(['pr', 'view', '--json', 'number', '--', 'agent-fix'], tmpdir())
    expect(reply).toEqual({ status: 1, stdout: '', stderr: 'no pull requests found' })
    const gh = calls.filter(call => call.command === 'gh')
    expect(gh).toHaveLength(1)
    expect(gh[0].options).toMatchObject({ maxOutputBytes: GH_OUTPUT_CAP, shell: false })
  })
})
