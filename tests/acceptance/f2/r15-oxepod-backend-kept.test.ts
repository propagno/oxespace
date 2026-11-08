// Frozen acceptance test for the 1.5.0 cockpit item R15 (OXE program, phase F2): the OxePod mode goes (FE), and its
// backend stays for the Containers panel. Written by the planner; the executor must not edit it. A guard, static only.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = process.cwd()

describe('R15 · the OxePod backend is kept when the mode goes', () => {
  test('R15: services/oxepod, oxepod.ipc and IPC_CHANNELS.oxePod stay', async () => {
    expect(['electron/main/services/oxepod', 'electron/main/ipc/oxepod.ipc.ts'].filter(path => !existsSync(join(ROOT, path)))).toEqual([])
    const { IPC_CHANNELS } = await import('../../../shared/types/ipc')
    expect('oxePod' in IPC_CHANNELS).toBe(true)
  })

  test('R15: the container MCP tools stay', () => {
    const tools = readFileSync(join(ROOT, 'electron/main/mcp-internal/oxequery-tools.ts'), 'utf8')
    for (const name of ['oxespace_containers_list', 'oxespace_container_logs', 'oxespace_container_action']) expect(tools, name).toContain(`'${name}'`)
  })
})
