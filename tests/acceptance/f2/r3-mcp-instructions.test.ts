// Frozen acceptance test for the 1.5.0 cockpit item R3 (OXE program, phase F2, spec test T8): the MCP bridge's
// INSTRUCTIONS are rewritten without the removed tools. Written by the planner; the executor must not edit it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const BRIDGE = readFileSync(join(process.cwd(), 'resources/mcp-bridge/oxespace-mcp.cjs'), 'utf8')
const REMOVED = ['oxespace_hybrid_explore', 'oxespace_semantic_search', 'oxespace_code_', 'oxespace_memory_', 'oxespace_linear', 'oxespace_automations', 'oxespace_documentation_']

function instructions(): string {
  const match = /const INSTRUCTIONS = (['"`])((?:\\.|(?!\1)[\s\S])*)\1/.exec(BRIDGE)
  if (!match) throw new Error('INSTRUCTIONS is not a single string constant')
  return match[2]
}

describe('R3 · the MCP INSTRUCTIONS after hybrid explore and semantic search go', () => {
  test('R3: INSTRUCTIONS is at most 600 characters and names no removed tool', () => {
    const text = instructions()
    expect(text.length).toBeGreaterThan(0)
    expect(text.length).toBeLessThanOrEqual(600)
    expect(REMOVED.filter(name => text.includes(name))).toEqual([])
  })

  test('R3: the bridge no longer gates its instructions on a removed tool', () => {
    expect(REMOVED.filter(name => BRIDGE.includes(name))).toEqual([])
  })
})
