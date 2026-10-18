import { describe, expect, it } from 'vitest'
import { TOOL_CATALOG, TOOL_GROUPS } from '../src/components/Workspace/toolCatalog'

describe('tool catalogue', () => {
  it('has unique ids and labels, each in a known group', () => {
    expect(new Set(TOOL_CATALOG.map(tool => tool.id)).size).toBe(TOOL_CATALOG.length)
    expect(new Set(TOOL_CATALOG.map(tool => tool.label)).size).toBe(TOOL_CATALOG.length)
    for (const tool of TOOL_CATALOG) expect(TOOL_GROUPS).toContain(tool.group)
  })
})
