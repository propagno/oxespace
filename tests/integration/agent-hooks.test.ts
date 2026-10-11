import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { claudeEventPlan, mapHookEvent, versionReaches } from '../../electron/main/services/agent-hooks/events'
import { AgentHookInstaller, STATUS_HOOK_FILE } from '../../electron/main/services/agent-hooks/installer'
import { AgentHookServer } from '../../electron/main/services/agent-hooks/server'
import type { AgentHookStatusEvent } from '../../shared/types/agent-hooks'

const HOOK_SCRIPT = join(process.cwd(), 'resources', 'agent-hooks', STATUS_HOOK_FILE)

describe('mapHookEvent', () => {
  test('maps lifecycle events to pane states', () => {
    expect(mapHookEvent('claude-code', { hook_event_name: 'UserPromptSubmit' })).toBe('working')
    expect(mapHookEvent('claude-code', { hook_event_name: 'PreToolUse', tool_name: 'Bash' })).toBe('working')
    expect(mapHookEvent('claude-code', { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' })).toBe('waiting')
    expect(mapHookEvent('claude-code', { hook_event_name: 'PermissionRequest' })).toBe('waiting')
    expect(mapHookEvent('claude-code', { hook_event_name: 'Stop' })).toBe('done')
    expect(mapHookEvent('claude-code', { hook_event_name: 'StopFailure' })).toBe('done')
    expect(mapHookEvent('claude-code', { hook_event_name: 'SessionEnd' })).toBe('ended')
    expect(mapHookEvent('codex', { hook_event_name: 'Stop' })).toBe('done')
  })

  test('ignores subagent events except permission prompts', () => {
    expect(mapHookEvent('claude-code', { hook_event_name: 'PostToolUse', agent_id: 'sub-1' })).toBeNull()
    expect(mapHookEvent('claude-code', { hook_event_name: 'PermissionRequest', agent_id: 'sub-1' })).toBe('waiting')
  })

  test('only a fresh session start is an idle prompt', () => {
    expect(mapHookEvent('claude-code', { hook_event_name: 'SessionStart', source: 'startup' })).toBe('done')
    expect(mapHookEvent('claude-code', { hook_event_name: 'SessionStart', source: 'compact' })).toBeNull()
    expect(mapHookEvent('claude-code', { hook_event_name: 'Unknown' })).toBeNull()
  })
})

describe('claude event plan', () => {
  test('never includes an event the version does not know', () => {
    const names = (v: string | null): string[] => claudeEventPlan(v).map((e) => e.eventName)
    expect(names('1.0.30')).toEqual(['PreToolUse', 'PostToolUse'])
    expect(names('1.0.70')).not.toContain('PermissionRequest')
    expect(names('2.1.0')).toContain('PermissionRequest')
    expect(names('2.1.100')).toContain('StopFailure')
    // Unresolved: only what the baseline knows.
    expect(names(null)).not.toContain('PermissionRequest')
    expect(versionReaches('2.0.45', '2.0.45')).toBe(true)
    expect(versionReaches('2.0.9', '2.0.45')).toBe(false)
  })
})

describe('AgentHookServer', () => {
  let server: AgentHookServer
  let events: AgentHookStatusEvent[]

  beforeEach(async () => {
    events = []
    server = new AgentHookServer({
      authenticate: ({ executionId, token, workspaceId }) =>
        executionId === 'exec' && token === 'secret' ? { paneId: 'pane-1', workspaceId } : null,
      onStatus: (event) => events.push(event),
      now: () => 42
    })
    await server.start()
  })
  afterEach(() => server.stop())

  async function post(body: unknown, raw = false): Promise<number> {
    const response = await fetch(`http://127.0.0.1:${server.port}/hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ? (body as string) : JSON.stringify(body)
    })
    return response.status
  }

  test('accepts an authenticated delivery and emits the mapped state', async () => {
    const status = await post({
      executionId: 'exec', token: 'secret', workspaceId: 'ws', agent: 'claude-code',
      payload: { hook_event_name: 'PermissionRequest', session_id: 's1' }
    })
    expect(status).toBe(204)
    expect(events).toEqual([
      { paneId: 'pane-1', workspaceId: 'ws', agent: 'claude-code', state: 'waiting', event: 'PermissionRequest', at: 42, sessionId: 's1' }
    ])
  })

  test('rejects bad credentials and never emits', async () => {
    expect(await post({ executionId: 'exec', token: 'nope', workspaceId: 'ws', agent: 'codex', payload: { hook_event_name: 'Stop' } })).toBe(403)
    expect(events).toHaveLength(0)
  })

  test('fails open on malformed or unrelated input', async () => {
    expect(await post('{not json', true)).toBe(204)
    expect(await post({ hello: 'world' })).toBe(204)
    expect(await post({ executionId: 'exec', token: 'secret', workspaceId: 'ws', agent: 'other', payload: {} })).toBe(204)
    const get = await fetch(`http://127.0.0.1:${server.port}/hook`)
    expect(get.status).toBe(204)
    expect(events).toHaveLength(0)
  })

  test('the hook script delivers end to end and is inert outside OXESpace', async () => {
    const run = (env: Record<string, string>, payload: string): Promise<{ code: number | null; out: string }> =>
      new Promise((resolve) => {
        const clean = { ...process.env } as Record<string, string | undefined>
        for (const key of Object.keys(clean)) if (key.startsWith('OXESPACE_')) delete clean[key]
        const child = spawn(process.execPath, [HOOK_SCRIPT, 'claude-code'], {
          env: { ...clean, ELECTRON_RUN_AS_NODE: '1', ...env },
          stdio: ['pipe', 'pipe', 'ignore']
        })
        let out = ''
        child.stdout.on('data', (c: Buffer) => { out += c.toString() })
        child.on('close', (code) => resolve({ code, out }))
        child.stdin.end(payload)
      })

    const inert = await run({}, JSON.stringify({ hook_event_name: 'Stop' }))
    expect(inert).toEqual({ code: 0, out: '{}\n' })
    expect(events).toHaveLength(0)

    const delivered = await run(
      {
        OXESPACE_AGENT_HOOK_PORT: String(server.port),
        OXESPACE_EXECUTION_ID: 'exec',
        OXESPACE_EXECUTION_TOKEN: 'secret',
        OXESPACE_WORKSPACE_ID: 'ws'
      },
      JSON.stringify({ hook_event_name: 'Stop', session_id: 's2' })
    )
    expect(delivered).toEqual({ code: 0, out: '{}\n' })
    expect(events.map((e) => e.state)).toEqual(['done'])

    // A dead port still exits 0 with `{}`: the agent must never be blocked.
    const dead = await run(
      { OXESPACE_AGENT_HOOK_PORT: '1', OXESPACE_EXECUTION_ID: 'e', OXESPACE_EXECUTION_TOKEN: 't', OXESPACE_WORKSPACE_ID: 'w' },
      JSON.stringify({ hook_event_name: 'Stop' })
    )
    expect(dead).toEqual({ code: 0, out: '{}\n' })
  })
})

describe('AgentHookInstaller', () => {
  let home: string
  let claudePath: string
  let codexPath: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'oxe-agent-hooks-'))
    claudePath = join(home, 'claude', 'settings.json')
    codexPath = join(home, 'codex', 'hooks.json')
  })
  afterEach(() => {
    try { rmSync(home, { recursive: true, force: true }) } catch { /* temp */ }
  })

  const make = (version: string | null = '2.1.100'): AgentHookInstaller =>
    new AgentHookInstaller({
      directory: join(home, 'data'),
      scriptSource: '// hook',
      targets: { 'claude-code': () => claudePath, codex: () => codexPath },
      probeClaudeVersion: async () => version
    })
  const read = (path: string): { hooks: Record<string, Array<{ matcher?: string; hooks: unknown[] }>> } & Record<string, unknown> =>
    JSON.parse(readFileSync(path, 'utf8'))

  test('installs into a missing file and reports installed', async () => {
    const installer = make()
    const status = await installer.install('claude-code')
    expect(status).toMatchObject({ agent: 'claude-code', state: 'installed', missing: [] })
    expect(existsSync(installer.scriptPath)).toBe(true)
    const doc = read(claudePath)
    expect(Object.keys(doc.hooks)).toContain('PermissionRequest')
    expect(doc.hooks.PreToolUse[0].matcher).toBe('*')
    expect(JSON.stringify(doc.hooks.Stop)).toContain(STATUS_HOOK_FILE)
  })

  test('keeps user entries around ours across install, reinstall and remove', async () => {
    mkdirSync(join(home, 'claude'), { recursive: true })
    const user = { matcher: '', hooks: [{ type: 'command', command: 'echo user-stop' }] }
    writeFileSync(claudePath, JSON.stringify({ env: { A: '1' }, permissions: { allow: ['Bash'] }, hooks: { Stop: [user] } }))

    const installer = make()
    await installer.install('claude-code')
    await installer.install('claude-code') // idempotent: no duplicate managed entry
    let doc = read(claudePath)
    expect(doc.env).toEqual({ A: '1' })
    expect(doc.permissions).toEqual({ allow: ['Bash'] })
    expect(doc.hooks.Stop).toHaveLength(2)
    expect(doc.hooks.Stop[0]).toEqual(user)
    expect(existsSync(`${claudePath}.oxespace-status.bak`)).toBe(true)

    const removed = await installer.remove('claude-code')
    expect(removed.state).toBe('not_installed')
    doc = read(claudePath)
    expect(doc.hooks).toEqual({ Stop: [user] })
    expect(doc.env).toEqual({ A: '1' })
  })

  test('an old Claude is never given an event it would reject', async () => {
    const installer = make('1.0.40')
    const status = await installer.install('claude-code')
    expect(status.state).toBe('installed')
    expect(Object.keys(read(claudePath).hooks).sort()).toEqual(['PostToolUse', 'PreToolUse', 'Stop'])
  })

  test('leaves a malformed file untouched and reports an error', async () => {
    mkdirSync(join(home, 'claude'), { recursive: true })
    const original = JSON.stringify({ hooks: ['not', 'an', 'object'] })
    writeFileSync(claudePath, original)
    const status = await make().install('claude-code')
    expect(status.state).toBe('error')
    expect(readFileSync(claudePath, 'utf8')).toBe(original)
  })

  test('installs Codex hooks into hooks.json', async () => {
    const status = await make().install('codex')
    expect(status).toMatchObject({ agent: 'codex', state: 'installed' })
    expect(Object.keys(read(codexPath).hooks)).toContain('PermissionRequest')
  })
})
