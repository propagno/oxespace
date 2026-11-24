// @vitest-environment node
// OXE-304: perf-gate/summarize.mjs summarizes workspace: launch→grid (in-window)
// and handles older baseline runs that do not emit that metric gracefully.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'perf-gate', 'summarize.mjs')
const tempDirs: string[] = []

type SummaryRow = {
  metric: string
  unit: string
  medians: Record<string, number | null>
  delta: number | null
  ci: [number | null, number | null]
  paired: number
  verdict: string
  rounds: Record<string, Record<string, number>>
}

type SummaryJson = {
  label: string
  rounds: number[]
  rows: SummaryRow[]
}

function makeFixture(
  roundLogs: Record<string, Record<number, string>>
): { dir: string; jsonOut: string } {
  const dir = mkdtempSync(join(tmpdir(), 'oxe-perf-gate-summarize-'))
  tempDirs.push(dir)
  mkdirSync(join(dir, 'rounds'), { recursive: true })
  writeFileSync(
    join(dir, 'heads.json'),
    JSON.stringify([
      { side: 'A', ref: 'v1.5.0', sha: 'aaaaaaaaa111' },
      { side: 'B', ref: 'v1.5.1', sha: 'bbbbbbbbb222' },
      { side: 'C', ref: 'main', sha: 'ccccccccc333' }
    ])
  )
  for (const [side, rounds] of Object.entries(roundLogs)) {
    for (const [round, content] of Object.entries(rounds)) {
      writeFileSync(join(dir, 'rounds', `${side}-r${round}-bench.log`), content)
    }
  }
  return { dir, jsonOut: join(dir, 'summary.json') }
}

function resultLine(op: string, value: number): string {
  const f = value.toFixed(1)
  return `[RESULT] ${op.padEnd(40)} n=1 min=${f} mean=${f} p95=${f} max=${f} ms median=${f} first=${f} 🟢`
}

function runSummarize(dir: string, jsonOut: string): { markdown: string; json: SummaryJson } {
  const markdown = execFileSync(
    process.execPath,
    [SCRIPT, dir, 'windows-x64', '--json', jsonOut],
    { encoding: 'utf8' }
  )
  const json = JSON.parse(readFileSync(jsonOut, 'utf8')) as SummaryJson
  return { markdown, json }
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('OXE-304: perf-gate/summarize.mjs workspace launch→grid (in-window)', () => {
  it('summarizes paired baseline and candidate workspace: launch→grid (in-window) samples', () => {
    const { dir, jsonOut } = makeFixture({
      A: {
        1: resultLine('workspace: launch→grid (in-window)', 520),
        2: resultLine('workspace: launch→grid (in-window)', 510),
        3: resultLine('workspace: launch→grid (in-window)', 530)
      },
      B: {
        1: resultLine('workspace: launch→grid (in-window)', 450),
        2: resultLine('workspace: launch→grid (in-window)', 460),
        3: resultLine('workspace: launch→grid (in-window)', 440)
      },
      C: {
        1: resultLine('workspace: launch→grid (in-window)', 350),
        2: resultLine('workspace: launch→grid (in-window)', 360),
        3: resultLine('workspace: launch→grid (in-window)', 340)
      }
    })

    const { markdown, json } = runSummarize(dir, jsonOut)
    const row = json.rows.find(r => r.metric === 'Workspace: launch → grid (in-window)')

    expect(row).toBeDefined()
    expect(row?.unit).toBe('ms')
    expect(row?.medians).toEqual({ A: 520, B: 450, C: 350 })
    expect(row?.paired).toBe(3)
    expect(row?.delta).toBe(-100)
    expect(row?.verdict).toBe('improves')
    expect(markdown).toContain('| Workspace: launch → grid (in-window) (ms) | 520 | 450 | 350 | -100 [-100, -100] | improves |')
  })

  it('handles older baseline runs missing workspace: launch→grid (in-window) gracefully', () => {
    const { dir, jsonOut } = makeFixture({
      A: {
        1: resultLine('mode switch: Code→Thread', 22),
        2: resultLine('mode switch: Code→Thread', 23),
        3: resultLine('mode switch: Code→Thread', 24)
      },
      B: {
        1: resultLine('mode switch: Code→Thread', 20),
        2: resultLine('mode switch: Code→Thread', 21),
        3: resultLine('mode switch: Code→Thread', 22)
      },
      C: {
        1: `${resultLine('mode switch: Code→Thread', 20)}\n${resultLine('workspace: launch→grid (in-window)', 410)}`,
        2: `${resultLine('mode switch: Code→Thread', 21)}\n${resultLine('workspace: launch→grid (in-window)', 412)}`,
        3: `${resultLine('mode switch: Code→Thread', 22)}\n${resultLine('workspace: launch→grid (in-window)', 420)}`
      }
    })

    const { markdown, json } = runSummarize(dir, jsonOut)
    const row = json.rows.find(r => r.metric === 'Workspace: launch → grid (in-window)')

    expect(row).toBeDefined()
    expect(row?.medians).toEqual({ A: null, B: null, C: 412 })
    expect(row?.delta).toBeNull()
    expect(row?.ci).toEqual([null, null])
    expect(row?.paired).toBe(0)
    expect(row?.verdict).toBe('n/a')
    expect(markdown).toContain('| Workspace: launch → grid (in-window) (ms) | n/a | n/a | 412 | n/a | n/a |')
    expect(markdown).toContain('- Workspace: launch → grid (in-window): A n/a n/a n/a · B n/a n/a n/a · C 410 412 420')
  })
})
