import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MESSAGE_CODES } from '../shared/messages'
import before from './fixtures/hot-files/message-codes.before.json'
// @ts-expect-error plain ESM script without types; the test only calls messageShape.
import { messageShape } from '../scripts/hot-file-keys.mjs'

// S0.1 · A hot file split may move keys, never rename, drop or retype one. The fixture is the key set of origin/main
// before the split (scripts/hot-file-keys.mjs); later codes are additions, so the fixture never has to change.
const root = join(__dirname, '..')

describe('S0.1 · shared/messages split', () => {
  const after = messageShape(join(root, 'shared/messages.ts')) as Record<string, Record<string, string>>

  it('keeps every code of before the split, with the same parameters', () => {
    const lost = Object.keys(before).filter(code => !(code in after))
    expect(lost).toEqual([])
    for (const [code, params] of Object.entries(before)) expect(after[code], code).toEqual(params)
  })

  it('lists at runtime exactly the codes the type declares, each once', () => {
    expect(new Set(MESSAGE_CODES).size).toBe(MESSAGE_CODES.length)
    expect([...MESSAGE_CODES].sort()).toEqual(Object.keys(after).sort())
  })

  it('declares codes only in shared/messages/<domain>.ts, and merges every domain file', () => {
    const barrel = readFileSync(join(root, 'shared/messages.ts'), 'utf8')
    expect(barrel.match(/^\s+'[\w.]+':/gm) ?? []).toEqual([])
    const domains = readdirSync(join(root, 'shared/messages')).filter(name => name.endsWith('.ts')).map(name => name.slice(0, -3))
    for (const domain of domains) expect(barrel, domain).toContain(`from './messages/${domain}'`)
  })
})
