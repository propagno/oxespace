// Frozen acceptance test for 1.5.0 A20 (OXE program, phase F6): tool calls fold into one line per group. One shared
// mapping from a provider's tool event to a row { kind, verb, target, meta, at, failed, running, truncated }, and the
// group's counts (steps, read, edited files, ran, failed, fixed). Values only; the window words them and draws the 3 px bar
// by kind. Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f6-conversation.md §A20; DESIGN 1.5.0-f6-design.md U6.2.
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { foldSummary, toolRow, TOOL_ROW_KINDS } from '../../../shared/thread-tool-rows'
import type { ThreadEvent } from '../../../shared/types/thread'

type Tool = Extract<ThreadEvent, { type: 'tool' }>
const ROOT = process.platform === 'win32' ? 'C:\\work\\shop' : '/work/shop'
const tool = (name: string, over: Partial<Tool> = {}): Tool => ({ type: 'tool', id: `${name}-${Math.random().toString(36).slice(2)}`, name, state: 'completed', detail: '', startedAt: 1000, ...over })
const file = (path: string, kind: 'add' | 'update' | 'delete' = 'update', counts: { additions?: number; deletions?: number } = {}) => ({ path, kind, source: 'tool-input' as const, state: 'completed' as const, ...counts })
const SECRET = `sk-ant-${'z'.repeat(40)}`

describe('A20 · one row per tool call', () => {
  test('A20: the kinds are read, edit, run, query, http, container and other', () => {
    expect(TOOL_ROW_KINDS).toEqual(['read', 'edit', 'run', 'query', 'http', 'container', 'other'])
  })

  test('A20: Claude and Codex tools map to their kind', () => {
    const cases: Array<[string, Partial<Tool>, string]> = [
      ['Read', { detail: join(ROOT, 'a.ts') }, 'read'], ['Grep', { detail: 'TODO' }, 'read'], ['Glob', { detail: '**/*.ts' }, 'read'], ['LS', {}, 'read'],
      ['Edit', { files: [file(join(ROOT, 'a.ts'))] }, 'edit'], ['Write', { files: [file(join(ROOT, 'b.ts'), 'add')] }, 'edit'], ['MultiEdit', { files: [file(join(ROOT, 'c.ts'))] }, 'edit'], ['NotebookEdit', {}, 'edit'],
      ['apply_patch', { files: [file(join(ROOT, 'd.ts'))] }, 'edit'],
      ['Bash', { detail: 'npm test' }, 'run'], ['shell', { detail: 'ls' }, 'run'], ['command', { detail: 'git status' }, 'run'],
      ['oxespace_db_query', { detail: 'SELECT 1' }, 'query'], ['mcp__oxespace-delegation__oxespace_db_execute', { detail: 'UPDATE t' }, 'query'],
      ['WebFetch', { detail: 'https://example.com' }, 'http'], ['web_search', { detail: 'electron 38' }, 'http'],
      ['oxespace_container_action', { detail: 'restart api' }, 'container'], ['mcp__oxespace-delegation__oxespace_containers_list', {}, 'container'],
      ['TodoWrite', {}, 'other'], ['mcp__linear__create_issue', {}, 'other']
    ]
    for (const [name, over, kind] of cases) expect(toolRow(tool(name, over), ROOT).kind, name).toBe(kind)
  })

  test('A20: a row carries its target relative to the project, the time it started, and its meta', () => {
    const edit = toolRow(tool('Edit', { files: [file(join(ROOT, 'src', 'login.ts'), 'update', { additions: 12, deletions: 3 })], startedAt: 4242 }), ROOT)
    expect(edit).toMatchObject({ kind: 'edit', verb: 'edit', at: 4242, failed: false, running: false })
    expect(edit.target.replace(/\\/g, '/')).toBe('src/login.ts')
    expect(edit.meta).toEqual({ additions: 12, deletions: 3 })
    const run = toolRow(tool('Bash', { detail: 'npm test\nmore lines', exitCode: 1, state: 'failed' }), ROOT)
    expect(run).toMatchObject({ kind: 'run', target: 'npm test', failed: true, meta: { exitCode: 1 } })
  })

  test('A20: running, a non-zero exit, a failed state, and a cut output are flags on the row', () => {
    expect(toolRow(tool('Bash', { state: 'running' }), ROOT)).toMatchObject({ running: true, failed: false })
    expect(toolRow(tool('Bash', { exitCode: 2 }), ROOT)).toMatchObject({ failed: true })
    expect(toolRow(tool('Read', { state: 'failed' }), ROOT)).toMatchObject({ failed: true })
    expect(toolRow(tool('Bash', { output: 'x', outputTruncated: true } as Partial<Tool>), ROOT)).toMatchObject({ truncated: true })
    expect(toolRow(tool('Bash', { output: 'x' }), ROOT).truncated).toBeUndefined()
  })

  test('A20: the target is redacted and bounded, and never an absolute path inside the project', () => {
    const row = toolRow(tool('Bash', { detail: `curl -H "Authorization: Bearer ${SECRET}" https://api.example.com/${'x'.repeat(500)}` }), ROOT)
    expect(row.target).not.toContain(SECRET)
    expect(row.target.length).toBeLessThanOrEqual(160)
    expect(toolRow(tool('Read', { detail: join(ROOT, 'deep', 'file.ts') }), ROOT).target).not.toContain(ROOT)
  })
})

describe('A20 · the group summary', () => {
  test('A20: 3 reads, 2 edits on 2 files and 1 run fold into 6 steps, read 3, edited 2, ran 1', () => {
    const rows = [
      tool('Read', { detail: join(ROOT, 'a.ts') }), tool('Grep', { detail: 'x' }), tool('Glob', { detail: '*' }),
      tool('Edit', { files: [file(join(ROOT, 'a.ts'))] }), tool('Edit', { files: [file(join(ROOT, 'b.ts'))] }), tool('Bash', { detail: 'npm test' })
    ].map(event => toolRow(event, ROOT))
    expect(foldSummary(rows)).toEqual({ steps: 6, read: 3, edited: 2, ran: 1, queries: 0, http: 0, containers: 0, other: 0, failed: 0, fixed: 0, running: false })
  })

  test('A20: edits on the same file count it once', () => {
    const rows = [tool('Edit', { files: [file(join(ROOT, 'a.ts'))] }), tool('Edit', { files: [file(join(ROOT, 'a.ts'))] }), tool('MultiEdit', { files: [file(join(ROOT, 'a.ts')), file(join(ROOT, 'b.ts'))] })].map(event => toolRow(event, ROOT))
    expect(foldSummary(rows)).toMatchObject({ steps: 3, edited: 2 })
  })

  test('A20: a failure followed by the same step succeeding is fixed; one left failing is failed', () => {
    const fixed = [tool('Bash', { detail: 'npm test', exitCode: 1 }), tool('Edit', { files: [file(join(ROOT, 'a.ts'))] }), tool('Bash', { detail: 'npm test', exitCode: 0 })].map(event => toolRow(event, ROOT))
    expect(foldSummary(fixed)).toMatchObject({ failed: 0, fixed: 1 })
    const failed = [tool('Bash', { detail: 'npm test', exitCode: 1 }), tool('Bash', { detail: 'npm run lint', exitCode: 0 })].map(event => toolRow(event, ROOT))
    expect(foldSummary(failed)).toMatchObject({ failed: 1, fixed: 0 })
  })

  test('A20: a group with a running row says so, so the window keeps it open', () => {
    const rows = [tool('Read'), tool('Bash', { state: 'running' })].map(event => toolRow(event, ROOT))
    expect(foldSummary(rows).running).toBe(true)
  })
})
