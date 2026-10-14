import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(path, 'utf8')

/** The operations declared in the shared type, the IPC allowlist, the service and the worker must be one list. */
const declared = [...read('shared/types/oxequery.ts').matchAll(/^\s+'([a-z]+\.[A-Za-z]+)': \{ input:/gm)].map(match => match[1])
const allowed = [...read('electron/main/ipc/oxequery.ipc.ts').split('const OPS = new Set')[1].split(']')[0].matchAll(/'([a-z]+\.[A-Za-z]+)'/g)].map(match => match[1])
const serviced = new Set([...read('electron/main/services/oxequery/service.ts').matchAll(/case '([a-z]+\.[A-Za-z]+)'/g)].map(match => match[1]))
const worker = read('electron/main/workers/oxequery-worker.ts')

describe('OxeQuery operations', () => {
  it('are the same list in the types and the IPC allowlist', () => {
    expect(declared.length).toBeGreaterThan(40)
    expect([...allowed].sort()).toEqual([...declared].sort())
    expect(new Set(allowed).size).toBe(allowed.length)
  })

  it('are all handled by the service', () => {
    expect(declared.filter(op => !serviced.has(op))).toEqual([])
  })

  it('that reach a database are handled by the worker', () => {
    const forwarded = declared.filter(op => /^(sql|mongo)\./.test(op) && !['sql.cancel', 'sql.check'].includes(op))
    expect(forwarded.filter(op => !worker.includes(`'${op}'`))).toEqual([])
  })
})
