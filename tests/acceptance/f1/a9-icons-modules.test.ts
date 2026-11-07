// Frozen acceptance test for 1.5.0 A9 (T85 icons, OXE phase F1). The executor must not edit it.
// The Mandacaru icon set ships one module per icon (tree-shakable), never one big path map. The entry budget itself is the
// `bundle` phase gate (npm run verify:bundle, entry ≤ 284 kB).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
// The task creates this module; importing it makes "not built yet" fail on the missing target, not on a directory read.
import { OxeCodeIcon } from '../../../src/design/icons/OxeCodeIcon'

const DIR = join(__dirname, '..', '..', '..', 'src', 'design', 'icons')

describe('A9 · own icons as one module per icon', () => {
  const modules = readdirSync(DIR).filter(name => /^[A-Z][A-Za-z0-9]+\.tsx$/.test(name))

  test('the set covers the modes, Agora and History', () => {
    expect(typeof OxeCodeIcon).toBe('function')
    for (const name of ['OxeCodeIcon', 'OxeChatIcon', 'OxeQueryIcon', 'OxePodIcon', 'OxePostIcon', 'AgoraIcon', 'HistoryIcon']) {
      expect(modules).toContain(`${name}.tsx`)
    }
  })

  test('each module exports exactly one icon and stays small', () => {
    for (const name of modules) {
      const source = readFileSync(join(DIR, name), 'utf8')
      expect((source.match(/export (function|const) /g) ?? []).length).toBe(1)
      expect(source.length).toBeLessThan(2500)
    }
  })

  test('there is no barrel that imports every icon', () => {
    const files = readdirSync(DIR)
    for (const name of files.filter(file => /^index\.tsx?$/.test(file))) {
      const source = readFileSync(join(DIR, name), 'utf8')
      expect(source).not.toMatch(/import\s+\*\s+as/)
      expect(source).not.toMatch(/PATHS\s*[:=]/)
    }
  })

  test('icons draw with currentColor and are hidden from assistive tech by default', () => {
    for (const name of modules) {
      const source = readFileSync(join(DIR, name), 'utf8')
      expect(source).toMatch(/currentColor/)
      expect(source).toMatch(/aria-hidden/)
    }
  })
})
