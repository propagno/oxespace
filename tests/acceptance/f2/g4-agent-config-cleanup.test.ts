// Frozen acceptance test for the 1.5.0 F2 gap G4 (OXE program, phase F2, second batch): after an upgrade from 1.4.x,
// no agent config calls a script that 1.5.0 removed. Written by the planner; the executor must not edit it.
// Fake homes in temp folders only: never the user's ~/.claude or ~/.codex.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { removeLegacyAgentHooks } from '../../../electron/main/services/agent-hooks/legacy-cleanup'

const ROOT = process.cwd()
let base: string
let claudeSettings: string
let codexHooks: string
let adapters: string

const memoryHook = (event: string) => ({ type: 'command', command: `node "C:/Users/me/AppData/Roaming/oxespace/memory/adapters/oxespace-memory-hook.cjs" ${event}` })
const statusHook = { type: 'command', command: 'node "C:/app/resources/agent-hooks/oxespace-status-hook.cjs" claude' }
const userHook = { type: 'command', command: 'echo my own hook' }
const userRtkHook = { type: 'command', command: 'rtk hook claude' }

function claudeDoc() {
  return {
    model: 'opus', permissions: { allow: ['Bash(npm test)'] },
    hooks: {
      SessionStart: [{ matcher: '', hooks: [memoryHook('session-start')] }, { matcher: '', hooks: [userHook] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [statusHook, memoryHook('pre-tool'), userRtkHook] }],
      SessionEnd: [{ matcher: '', hooks: [memoryHook('session-end')] }]
    }
  }
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'oxe-g4-'))
  mkdirSync(join(base, 'claude')); mkdirSync(join(base, 'codex'))
  claudeSettings = join(base, 'claude', 'settings.json')
  codexHooks = join(base, 'codex', 'hooks.json')
  adapters = join(base, 'userData', 'memory', 'adapters')
  mkdirSync(adapters, { recursive: true })
  writeFileSync(join(adapters, 'oxespace-memory-hook.cjs'), '// old hook')
  writeFileSync(claudeSettings, JSON.stringify(claudeDoc(), null, 2))
  writeFileSync(codexHooks, JSON.stringify({ hooks: { SessionStart: [{ matcher: '', hooks: [memoryHook('session-start'), userHook] }] } }, null, 2))
})
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as { hooks?: Record<string, Array<{ matcher: string; hooks: unknown[] }>>; [key: string]: unknown }

describe('G4 · no agent config calls a removed script after the upgrade', () => {
  test('G4: the memory hook entries go from Claude and Codex; every other hook and setting stays as it was', async () => {
    const result = await removeLegacyAgentHooks({ claudeSettings, codexHooks, memoryAdapters: adapters })
    expect(result.changed.sort()).toEqual([claudeSettings, codexHooks].sort())
    const claude = read(claudeSettings)
    expect(claude.model).toBe('opus')
    expect(claude.permissions).toEqual({ allow: ['Bash(npm test)'] })
    expect(claude.hooks).toEqual({
      SessionStart: [{ matcher: '', hooks: [userHook] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [statusHook, userRtkHook] }]
    })
    expect(read(codexHooks).hooks).toEqual({ SessionStart: [{ matcher: '', hooks: [userHook] }] })
    for (const path of [claudeSettings, codexHooks]) expect(readFileSync(path, 'utf8')).not.toContain('oxespace-memory-hook')
  })

  test('G4: the removed hook script folder goes too', async () => {
    await removeLegacyAgentHooks({ claudeSettings, codexHooks, memoryAdapters: adapters })
    expect(existsSync(adapters)).toBe(false)
  })

  test('G4: it is idempotent: a second run changes nothing and rewrites no file', async () => {
    await removeLegacyAgentHooks({ claudeSettings, codexHooks, memoryAdapters: adapters })
    const before = [claudeSettings, codexHooks].map(path => ({ bytes: readFileSync(path), mtime: statSync(path).mtimeMs }))
    const again = await removeLegacyAgentHooks({ claudeSettings, codexHooks, memoryAdapters: adapters })
    expect(again.changed).toEqual([])
    ;[claudeSettings, codexHooks].forEach((path, index) => {
      expect(readFileSync(path).equals(before[index].bytes), path).toBe(true)
      expect(statSync(path).mtimeMs).toBe(before[index].mtime)
    })
  })

  test('G4: a config with nothing of ours is not rewritten; malformed or missing files are left alone without an error', async () => {
    const clean = JSON.stringify({ hooks: { Stop: [{ matcher: '', hooks: [userHook] }] } }, null, 2)
    writeFileSync(claudeSettings, clean)
    writeFileSync(codexHooks, '{ this is not json')
    const result = await removeLegacyAgentHooks({ claudeSettings, codexHooks, memoryAdapters: join(base, 'missing') })
    expect(result.changed).toEqual([])
    expect(result.skipped).toEqual([expect.objectContaining({ path: codexHooks })])
    expect(readFileSync(claudeSettings, 'utf8')).toBe(clean)
    expect(readFileSync(codexHooks, 'utf8')).toBe('{ this is not json')
    const none = await removeLegacyAgentHooks({ claudeSettings: join(base, 'nope', 'settings.json'), codexHooks: join(base, 'nope', 'hooks.json') })
    expect(none.changed).toEqual([])
    expect(existsSync(join(base, 'nope'))).toBe(false)
  })

  test('G4: nothing in the app installs the memory hook again, and the cleanup never resolves the real home itself', () => {
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(join(ROOT, dir))) {
        if (name === 'node_modules' || name === 'vendor') continue
        const rel = `${dir}/${name}`
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel)
        else if (/\.(ts|cjs|mjs|js)$/.test(name)) files.push(rel)
      }
    }
    walk('electron'); walk('resources')
    const mentions = files.filter(file => readFileSync(join(ROOT, file), 'utf8').includes('oxespace-memory-hook'))
    expect(mentions).toEqual(['electron/main/services/agent-hooks/legacy-cleanup.ts'])
    expect(readFileSync(join(ROOT, 'electron/main/services/agent-hooks/legacy-cleanup.ts'), 'utf8')).not.toMatch(/\bhomedir\s*\(/)
    expect(readFileSync(join(ROOT, 'electron/main/index.ts'), 'utf8')).toContain('removeLegacyAgentHooks(')
  })

  test('G4: RTK is no longer put on the terminal PATH, and the terminal start input has no RTK switch', () => {
    expect(readFileSync(join(ROOT, 'electron/main/services/terminal.service.ts'), 'utf8')).not.toMatch(/rtk/i)
    expect(readFileSync(join(ROOT, 'shared/types/ipc/terminal.ts'), 'utf8')).not.toMatch(/disableRtk/)
  })
})
