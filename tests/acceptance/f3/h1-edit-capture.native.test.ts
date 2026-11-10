// Frozen acceptance test for 1.5.0 A10 (OXE program, phase F3), TECH LEAD's G-b decision of 08/11: an agent's file edit,
// seen through the hook server, becomes a changes row with its path, first changed line and +/- counts, computed at
// capture from the edit tool's input. No diff body and no file content is ever stored; the path is redacted like a
// command. Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-h1-http-audit.md §H1-6.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f3/h1-edit-capture.native.test.ts
import { request } from 'node:http'
import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { summarizeEdits } from '../../../electron/main/services/agent-hooks/edit-capture'
import { hookServerOptionsFor } from '../../../electron/main/services/agent-hooks/hook-pipeline'
import { AgentHookServer } from '../../../electron/main/services/agent-hooks/server'
import { AgentActivity } from '../../../electron/main/services/agent-activity/read-model'

const open: AppDatabase[] = []
let server: AgentHookServer | null = null
afterEach(() => { server?.stop(); server = null; for (const db of open.splice(0)) db.close() })

const post = (tool: string, input: Record<string, unknown>, response: Record<string, unknown> = {}, event = 'PostToolUse') =>
  ({ hook_event_name: event, tool_name: tool, tool_use_id: `toolu_${tool}_${Math.random().toString(36).slice(2)}`, session_id: 's1', tool_input: input, tool_response: response })

describe('H1-6 · what an edit changed, from its tool input', () => {
  test('H1-6: a Claude Edit with a structured patch gives the path, the first changed line and the counts', () => {
    const record = post('Edit', { file_path: 'src/login.ts', old_string: 'b', new_string: 'c\nd' }, {
      filePath: 'src/login.ts',
      structuredPatch: [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 4, lines: [' a', '-b', '+c', '+d', ' e'] }]
    })
    expect(summarizeEdits(record)).toEqual([{ tool: 'Edit', path: 'src/login.ts', line: 11, added: 2, removed: 1 }])
  })

  test('H1-6: without a structured patch, the counts come from the old and new strings, and the line is unknown', () => {
    const record = post('Edit', { file_path: 'src/a.ts', old_string: 'x\ny\nz', new_string: 'x\nY\nY2\nz' })
    expect(summarizeEdits(record)).toEqual([{ tool: 'Edit', path: 'src/a.ts', line: null, added: 2, removed: 1 }])
  })

  test('H1-6: MultiEdit adds up its hunks, with the first line among them', () => {
    const record = post('MultiEdit', { file_path: 'src/m.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] }, {
      structuredPatch: [
        { oldStart: 40, oldLines: 1, newStart: 40, newLines: 1, lines: ['-c', '+d'] },
        { oldStart: 3, oldLines: 2, newStart: 3, newLines: 2, lines: [' k', '-a', '+b'] }
      ]
    })
    expect(summarizeEdits(record)).toEqual([{ tool: 'MultiEdit', path: 'src/m.ts', line: 4, added: 2, removed: 2 }])
  })

  test('H1-6: Write of a new file counts its lines as added from line 1; an update with a patch counts the patch', () => {
    expect(summarizeEdits(post('Write', { file_path: 'notes/new.md', content: 'a\nb\nc\n' }, { type: 'create' }))).toEqual([{ tool: 'Write', path: 'notes/new.md', line: 1, added: 3, removed: 0 }])
    expect(summarizeEdits(post('Write', { file_path: 'notes/old.md', content: 'a\nB\n' }, { type: 'update', structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', '-b', '+B'] }] })))
      .toEqual([{ tool: 'Write', path: 'notes/old.md', line: 2, added: 1, removed: 1 }])
  })

  test('H1-6: a Codex apply_patch gives one row per file, with the counts and no line', () => {
    const patch = ['*** Begin Patch', '*** Update File: src/x.ts', '@@ function x', '-old', '+new', '+more', '*** Add File: src/y.ts', '+y1', '+y2', '*** End Patch'].join('\n')
    expect(summarizeEdits(post('apply_patch', { patch }))).toEqual([
      { tool: 'apply_patch', path: 'src/x.ts', line: null, added: 2, removed: 1 },
      { tool: 'apply_patch', path: 'src/y.ts', line: null, added: 2, removed: 0 }
    ])
  })

  test('H1-6: other tools, other events, and inputs without a path give nothing', () => {
    expect(summarizeEdits(post('Bash', { command: 'echo hi > a.txt' }))).toEqual([])
    expect(summarizeEdits(post('Read', { file_path: 'a.ts' }))).toEqual([])
    expect(summarizeEdits(post('Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' }, {}, 'PreToolUse'))).toEqual([])
    expect(summarizeEdits(post('Edit', { old_string: 'a', new_string: 'b' }))).toEqual([])
  })

  test('H1-6: the path is redacted like a command: a token or a userinfo in it is masked; a plain path is kept', () => {
    const token = `ghp_${'a1B2c3D4e5'.repeat(4)}`
    const [tokened] = summarizeEdits(post('Write', { file_path: `/tmp/${token}/x.txt`, content: 'x' }, { type: 'create' }))
    expect(tokened.path).not.toContain(token)
    const [userinfo] = summarizeEdits(post('Write', { file_path: 'https://dev:hunter2secret@host.example/x.txt', content: 'x' }, { type: 'create' }))
    expect(userinfo.path).not.toContain('hunter2secret')
    expect(summarizeEdits(post('Write', { file_path: 'C:\\work\\shop\\src\\app.ts', content: 'x' }, { type: 'create' }))[0].path).toBe('C:\\work\\shop\\src\\app.ts')
  })
})

describe('H1-6 · stored through the hook server as changes rows', () => {
  async function serve(db: AppDatabase): Promise<(payload: Record<string, unknown>) => Promise<void>> {
    server = new AgentHookServer(hookServerOptionsFor({
      db, now: () => 7000,
      authenticate: input => (input.token === 'token-1' ? { paneId: 'p1', workspaceId: 'ws-1' } : null),
      onStatus: () => undefined
    }))
    const port = await server.start()
    return async payload => {
      const body = JSON.stringify({ executionId: 'exec-1', token: 'token-1', workspaceId: 'ws-1', agent: 'claude-code', payload })
      await new Promise<void>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => { res.resume(); res.on('end', () => resolve()) })
        req.on('error', reject); req.end(body)
      })
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  test('H1-6: an Edit posted to the hook server is one changes row, and A10 lists it with path, line and counts', async () => {
    const db = openInMemoryDatabase(); open.push(db)
    const send = await serve(db)
    await send(post('Edit', { file_path: 'src/login.ts', old_string: 'b', new_string: 'c\nd' }, { structuredPatch: [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 4, lines: [' a', '-b', '+c', '+d', ' e'] }] }))
    const rows = db.prepare('SELECT actor, workspace_id, tool, action, level, decision, outcome, path, line, added, removed FROM agent_action_audit').all()
    expect(rows).toEqual([{ actor: 'pane:p1', workspace_id: 'ws-1', tool: 'Edit', action: 'edit', level: 'write', decision: 'hook', outcome: 'ok', path: 'src/login.ts', line: 11, added: 2, removed: 1 }])
    const [row] = new AgentActivity(db, { isProductionHost: () => false, pendingFor: () => false, now: () => 8000 }).list({ sources: ['changes'] }).rows
    expect(row).toMatchObject({ source: 'changes', path: 'src/login.ts', line: 11, added: 2, removed: 1, write: true, outcome: 'ok' })
  })

  test('H1-6: a failed edit is stored with outcome error; a PreToolUse is not stored', async () => {
    const db = openInMemoryDatabase(); open.push(db)
    const send = await serve(db)
    await send(post('Edit', { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' }, {}, 'PreToolUse'))
    await send(post('Edit', { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' }, { error: 'String not found' }, 'PostToolUseFailure'))
    expect(db.prepare('SELECT tool, outcome, path FROM agent_action_audit').all()).toEqual([{ tool: 'Edit', outcome: 'error', path: 'src/a.ts' }])
  })

  test('H1-6: no diff body and no file content reaches any table', async () => {
    const db = openInMemoryDatabase(); open.push(db)
    const send = await serve(db)
    await send(post('Edit', { file_path: 'src/s.ts', old_string: 'OLD-BODY-MARKER', new_string: 'NEW-BODY-MARKER' }, { structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-OLD-BODY-MARKER', '+NEW-BODY-MARKER'] }], originalFile: 'ORIGINAL-FILE-MARKER' }))
    await send(post('Write', { file_path: 'src/w.ts', content: 'WRITE-CONTENT-MARKER' }, { type: 'create' }))
    await send(post('apply_patch', { patch: '*** Begin Patch\n*** Add File: src/p.ts\n+PATCH-BODY-MARKER\n*** End Patch' }))
    expect((db.prepare('SELECT COUNT(*) AS n FROM agent_action_audit').get() as { n: number }).n).toBe(3)
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map(entry => entry.name)
    const all = tables.map(name => JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())).join('\n')
    for (const marker of ['OLD-BODY-MARKER', 'NEW-BODY-MARKER', 'ORIGINAL-FILE-MARKER', 'WRITE-CONTENT-MARKER', 'PATCH-BODY-MARKER']) expect(all, marker).not.toContain(marker)
  })
})
