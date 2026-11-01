/**
 * OxeVoice F1 · CR-07 (TECH LEAD + coordinator) — frozen acceptance test (written by the plan, before execution; do
 * not edit). `thread.json` is a hot file shared with other teams: the voice copy lives in its own lazy namespace
 * `voice` (`shared/locales/{en,pt-BR}/voice.json`), registered in the renderer's lazy catalog list.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const json = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as Record<string, unknown>

describe('voice copy namespace (CR-07)', () => {
  it('thread.json carries no voice keys in either language', () => {
    expect(json('shared/locales/en/thread.json')).not.toHaveProperty('voice')
    expect(json('shared/locales/pt-BR/thread.json')).not.toHaveProperty('voice')
  })

  it('voice.json exists in en and pt-BR with the same keys', () => {
    const keys = (value: unknown, prefix = ''): string[] => value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)]
    const en = keys(json('shared/locales/en/voice.json')).sort()
    const pt = keys(json('shared/locales/pt-BR/voice.json')).sort()
    expect(en.length).toBeGreaterThan(10)
    expect(pt).toEqual(en)
    for (const key of ['hold', 'listening', 'openSettings', 'privacy.osCloud', 'privacy.onDevice', 'consent.body', 'consentPlace', 'settings.title', 'settings.off']) expect(en).toContain(key)
  })

  it('the renderer registers voice as a lazy namespace', () => {
    const i18n = readFileSync(resolve(root, 'src/i18n/index.ts'), 'utf8')
    expect(i18n).toMatch(/LazyNamespace\s*=[^\n]*'voice'/)
    expect(i18n).toMatch(/voice:\s*\{\s*en:\s*\(\)\s*=>\s*import\('..\/..\/shared\/locales\/en\/voice\.json'\)/)
  })
})
