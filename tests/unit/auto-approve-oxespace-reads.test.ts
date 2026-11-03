import { describe, expect, it } from 'vitest'
import { evaluatePermission } from '../../electron/main/services/conversation/kernel/permission-policy'
import { isOxespaceReadOnlyTool, OXESPACE_BRIDGE_KEY, THREAD_READ_ONLY_MCP_TOOLS } from '../../electron/main/services/conversation/read-only-mcp-tools'
import { MCP_COVERAGE } from '../../shared/mcp-coverage'
import type { ThreadPermissionRule, ThreadRequest } from '../../shared/types/thread'

/**
 * T53: OXESpace's own read-only MCP lookups join "Auto-approve reads" when the project has no rule for them. Only from
 * OXESpace's server (its key and the tool's name together); another server's tool of the same name still asks; with
 * the setting off they ask; a saved rule still decides.
 */

const root = process.platform === 'win32' ? 'C:\\work\\app' : '/work/app'
const approval = (toolName: string): Pick<ThreadRequest, 'kind' | 'command' | 'paths' | 'toolName'> => ({ kind: 'approval', toolName })
const rule = (pattern: string, decision: ThreadPermissionRule['decision']): ThreadPermissionRule =>
  ({ id: pattern, projectRoot: root, kind: 'tool', pattern, decision, createdAt: 0 }) as ThreadPermissionRule
const own = (tool: string) => `mcp__${OXESPACE_BRIDGE_KEY}__${tool}`

describe('OXESpace read-only lookups under "Auto-approve reads"', () => {
  it('approves each listed lookup from OXESpace\'s own server, marked as the safe list', () => {
    for (const tool of THREAD_READ_ONLY_MCP_TOOLS) {
      expect(evaluatePermission(approval(own(tool)), root, [], {}, { readOnlyList: true }), tool)
        .toMatchObject({ decision: 'allow', safeList: true })
    }
    // On by default, like the shell list.
    expect(evaluatePermission(approval(own('oxespace_code_impact')), root, [])).toMatchObject({ decision: 'allow', safeList: true })
  })

  it('a third-party server with a tool of the same name, or the bare name, still asks', () => {
    for (const server of ['oxespace', 'evil', 'oxespace-delegation-2', 'Oxespace-Delegation']) {
      expect(evaluatePermission(approval(`mcp__${server}__oxespace_code_impact`), root, [], {}, { readOnlyList: true }), server)
        .toMatchObject({ decision: 'ask' })
    }
    expect(isOxespaceReadOnlyTool('evil', 'oxespace_code_impact')).toBe(false)
    expect(evaluatePermission(approval('oxespace_code_impact'), root, [], {}, { readOnlyList: true })).toBeUndefined()
  })

  it('asks for every lookup when the setting is off', () => {
    for (const tool of THREAD_READ_ONLY_MCP_TOOLS) {
      expect(evaluatePermission(approval(own(tool)), root, [], {}, { readOnlyList: false }), tool).toMatchObject({ decision: 'ask' })
    }
  })

  it('never approves a tool of OXESpace\'s that writes, starts work or asks the person', () => {
    for (const tool of ['oxespace_git_change', 'oxespace_db_execute', 'oxespace_delegate_task', 'oxespace_thread_send', 'oxespace_create_worktree', 'oxespace_work_plan']) {
      expect(evaluatePermission(approval(own(tool)), root, [], {}, { readOnlyList: true }), tool).toMatchObject({ decision: 'ask' })
    }
  })

  it('a saved rule still decides first: a deny blocks a lookup, whatever the setting', () => {
    expect(evaluatePermission(approval(own('oxespace_code_impact')), root, [rule(`${OXESPACE_BRIDGE_KEY}/oxespace_code_impact`, 'deny')], {}, { readOnlyList: true }))
      .toMatchObject({ decision: 'deny' })
    expect(evaluatePermission(approval(own('oxespace_code_impact')), root, [rule(`${OXESPACE_BRIDGE_KEY}/*`, 'deny')], {}, { readOnlyList: true }))
      .toMatchObject({ decision: 'deny' })
    // A person's allow is their own rule, not the safe list.
    expect(evaluatePermission(approval(own('oxespace_code_impact')), root, [rule(`${OXESPACE_BRIDGE_KEY}/oxespace_code_impact`, 'allow')], {}, { readOnlyList: false }))
      .toEqual({ decision: 'allow', reasons: ['Covered by the project permission rules.'] })
  })

  it('every listed lookup is a read in the MCP coverage manifest, in every action it has', () => {
    const levels = new Map<string, string[]>()
    for (const capability of Object.values(MCP_COVERAGE)) {
      if (!('tools' in capability)) continue
      for (const [ref, level] of Object.entries(capability.tools)) {
        const name = ref.split('#')[0]
        levels.set(name, [...levels.get(name) ?? [], level])
      }
    }
    for (const tool of THREAD_READ_ONLY_MCP_TOOLS) {
      expect(levels.get(tool), `${tool} is declared`).toBeDefined()
      expect([...new Set(levels.get(tool))], tool).toEqual(['read'])
    }
  })
})
