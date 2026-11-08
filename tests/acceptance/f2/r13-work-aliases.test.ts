// Frozen acceptance test for the 1.5.0 cockpit item R13 (OXE program, phase F2): Work folds into Delegation, and its
// tool names stay one release as aliases. Written by the planner; the executor must not edit it. Static checks only.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = process.cwd()
const MCP = 'electron/main/mcp-internal'
const ALIASES = ['oxespace_work_plan', 'oxespace_work_status', 'oxespace_work_result', 'oxespace_work_message', 'oxespace_work_cancel']

describe('R13 · Work folds into Delegation', () => {
  test('R13: the oxespace_work_* names are still registered, outside the removed work-tools module', () => {
    expect(existsSync(join(ROOT, MCP, 'work-tools.ts'))).toBe(false)
    const text = readdirSync(join(ROOT, MCP)).filter(name => name.endsWith('.ts')).map(name => readFileSync(join(ROOT, MCP, name), 'utf8')).join('\n')
    expect(ALIASES.filter(name => !new RegExp(`['"\`]${name}['"\`]`).test(text))).toEqual([])
  })

  test('R13: the phone protocol still knows the work kind, so an older phone keeps decoding', () => {
    const protocol = readFileSync(join(ROOT, 'shared/remote/protocol.ts'), 'utf8')
    const kinds = /REMOTE_AGENT_KINDS\s*=\s*\[([^\]]*)\]/.exec(protocol)?.[1] ?? ''
    expect(kinds).toContain("'work'")
  })
})
