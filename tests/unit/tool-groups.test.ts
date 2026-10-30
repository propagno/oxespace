import { describe, expect, it } from 'vitest'
import { projectToolModes, sessionToolPlan, usesToolSearch } from '../../electron/main/services/conversation/tool-groups'
import { THREAD_TOOL_GROUPS } from '../../electron/main/services/conversation/thread-mcp'
import { parseOxeYaml } from '../../electron/main/services/repo-config/parser'

const modesOf = (yaml: string) => projectToolModes(parseOxeYaml(yaml)?.thread)
const defaults = projectToolModes(undefined)

describe('project tool modes', () => {
  it('puts every configurable group on demand by default', () => {
    expect(defaults).toEqual({
      orchestration: { mode: 'on-demand', source: 'default' }, data: { mode: 'on-demand', source: 'default' },
      docs: { mode: 'on-demand', source: 'default' }, app: { mode: 'on-demand', source: 'default' }
    })
  })

  it('reads the 1.3 list form as always on', () => {
    expect(modesOf('thread:\n  tools: [data, docs, team, nonsense]')).toMatchObject({ data: { mode: 'always', source: 'project' }, docs: { mode: 'always', source: 'project' }, app: { mode: 'on-demand', source: 'default' } })
  })

  it('reads the map form and ignores unknown groups and modes', () => {
    const modes = modesOf('thread:\n  tools:\n    data: off\n    docs: always\n    app: sometimes\n    core: off\n    worker: always')
    expect(modes.data).toEqual({ mode: 'off', source: 'project' })
    expect(modes.docs).toEqual({ mode: 'always', source: 'project' })
    expect(modes.app).toEqual({ mode: 'on-demand', source: 'default' })
    expect(Object.keys(modes).sort()).toEqual(['app', 'data', 'docs', 'orchestration'])
  })
})

describe('session tool plan (B7.2)', () => {
  const core = [...THREAD_TOOL_GROUPS.core]

  it('with tool search, offers every group that is not off and nothing to turn on', () => {
    const modes = { ...defaults, data: { mode: 'off' as const, source: 'project' as const } }
    const plan = sessionToolPlan(true, {}, modes)
    expect(plan.enableable).toEqual({})
    for (const group of ['orchestration', 'docs', 'app'] as const) expect(plan.tools).toEqual(expect.arrayContaining([...THREAD_TOOL_GROUPS[group]]))
    expect(plan.tools).not.toContain('oxespace_db_query')
    expect(plan.tools).not.toContain('oxespace_tools_enable')
    expect(plan.tools).not.toContain('oxespace_team_inbox')
  })

  it('without tool search, offers core and always groups, and lets the session turn on the on-demand ones', () => {
    const modes = { ...defaults, docs: { mode: 'always' as const, source: 'project' as const }, app: { mode: 'off' as const, source: 'project' as const } }
    const plan = sessionToolPlan(false, {}, modes)
    expect(plan.tools).toEqual([...new Set([...core, ...THREAD_TOOL_GROUPS.docs]), 'oxespace_tools_enable'])
    expect(Object.keys(plan.enableable).sort()).toEqual(['data', 'orchestration'])
    expect(plan.enableable.data).toEqual([...THREAD_TOOL_GROUPS.data])
    expect(plan.enableable).not.toHaveProperty('app')
  })

  it('adds the role groups and never offers them to turn on', () => {
    const plan = sessionToolPlan(false, { team: true, worker: true }, defaults)
    expect(plan.tools).toEqual(expect.arrayContaining([...THREAD_TOOL_GROUPS.team, ...THREAD_TOOL_GROUPS.worker]))
    expect(Object.keys(plan.enableable)).not.toContain('team')
    expect(Object.keys(plan.enableable)).not.toContain('worker')
    expect(new Set(plan.tools).size).toBe(plan.tools.length)
  })

  it('adds only the enable tool to a plain conversation without tool search, and nothing when there is nothing to enable', () => {
    expect(sessionToolPlan(false, {}, defaults).tools).toEqual([...core, 'oxespace_tools_enable'])
    const fixed = Object.fromEntries(Object.keys(defaults).map(group => [group, { mode: 'off', source: 'project' }])) as typeof defaults
    expect(sessionToolPlan(false, {}, fixed)).toEqual({ tools: core, enableable: {} })
    expect(sessionToolPlan(true, {}, fixed)).toEqual({ tools: core, enableable: {} })
  })

  it('knows when Claude runs with tool search', () => {
    expect(usesToolSearch('claude', { ENABLE_TOOL_SEARCH: 'true' })).toBe(true)
    expect(usesToolSearch('claude', { ENABLE_TOOL_SEARCH: '1' })).toBe(true)
    // auto:N defers only above a share of the context window, which a large window never reached in T8.
    for (const value of ['auto:5', 'auto', 'false', '0', '', undefined]) expect(usesToolSearch('claude', { ENABLE_TOOL_SEARCH: value }), String(value)).toBe(false)
    expect(usesToolSearch('codex', { ENABLE_TOOL_SEARCH: 'auto:5' })).toBe(false)
  })
})
