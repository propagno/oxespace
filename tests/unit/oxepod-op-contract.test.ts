import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null } }))
const { OXEPOD_OPS } = await import('../../electron/main/ipc/oxepod.ipc')
const { OXEQUERY_OPS } = await import('../../electron/main/ipc/oxequery.ipc')

const read = (path: string): string => readFileSync(path, 'utf8')

/** The operations declared in the shared type, the IPC allowlist and the service must be one list. */
const declared = [...read('shared/types/oxepod.ts').matchAll(/^\s+'([a-z]+\.[A-Za-z]+)': \{ input:/gm)].map(match => match[1])
const allowed: string[] = [...OXEPOD_OPS]
const serviced = new Set([...read('electron/main/services/oxepod/service.ts').matchAll(/case '([a-z]+\.[A-Za-z]+)'/g)].map(match => match[1]))

describe('OxePod operations', () => {
  it('are the same list in the types and the IPC allowlist', () => {
    expect(declared.length).toBe(20)
    expect([...allowed].sort()).toEqual([...declared].sort())
    expect(new Set(allowed).size).toBe(allowed.length)
  })

  it('are all handled by the service, which handles nothing else', () => {
    expect(declared.filter(op => !serviced.has(op))).toEqual([])
    expect([...serviced].filter(op => !declared.includes(op))).toEqual([])
  })

  it('are containers and resources only, and none is also OxeQuery\'s', () => {
    expect(declared.filter(op => !/^(containers|resources)\./.test(op))).toEqual([])
    expect(allowed.filter(op => (OXEQUERY_OPS as readonly string[]).includes(op))).toEqual([])
  })
})
