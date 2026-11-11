// Frozen acceptance test for 1.5.0 A39–A41 and A66 (OXE program, phase F11): what ships. The installers are named
// "OXESpace" with the version and never a beta, RC or build hash (A39); a 1.4.3 phone still speaks the desktop's
// protocol version or gets a refusal, never silence (A41); the build diary has a page per phase with its five parts,
// and nothing in it is a secret, a home path or an e-mail address (A66). Reads data files (the builder config and the
// diary pages), never source code. Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f11-release.md §A39–A41, §A66; DESIGN 1.5.0-f11-design.md U11.2, U11.4.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, test } from 'vitest'
import { REMOTE_ERROR_CODES, REMOTE_PROTOCOL_VERSION } from '../../../shared/remote/protocol'
import { redactSecrets } from '../../../shared/secrets'

const builder = load(readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8')) as Record<string, unknown>
const DIARY = join(process.cwd(), 'docs/build-diary')
const PHASES = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11']

/** Every string value in the builder config under keys that name what a person sees or downloads. */
function shippedNames(node: unknown, path = ''): Array<[string, string]> {
  if (!node || typeof node !== 'object') return []
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => {
    const at = path ? `${path}.${key}` : key
    if (typeof value === 'string' && /^(productName|artifactName|shortcutName|uninstallDisplayName|title|synopsis|executableName)$/.test(key)) return [[at, value] as [string, string]]
    return shippedNames(value, at)
  })
}

describe('A39 · the installers', () => {
  test('A39: the product is "OXESpace" and every artifact carries the version, never a beta, an RC or a build hash', () => {
    expect(builder.productName).toBe('OXESpace')
    const names = shippedNames(builder)
    const artifacts = names.filter(([key]) => key.endsWith('artifactName'))
    // The path is live: the config names its artifacts.
    expect(artifacts.length).toBeGreaterThan(0)
    for (const [key, value] of artifacts) expect(value, key).toMatch(/^(OXESpace|\$\{productName\})-\$\{version\}/)
    for (const [key, value] of names) expect(value, key).not.toMatch(/beta|\brc\b|-rc|\$\{(buildNumber|commit|hash|sha)\}|[0-9a-f]{7,40}/i)
  })
})

describe('A41 · a 1.4.3 phone', () => {
  test('A41: the desktop still speaks protocol version 1, the one 1.4.3 phones send, and an unknown version is refused by code', () => {
    expect(REMOTE_PROTOCOL_VERSION).toBe(1)
    expect(REMOTE_ERROR_CODES).toContain('unsupported-version')
  })
})

describe('A66 · the build diary', () => {
  test('A66: an index links every phase, and each phase page has its title, the summary line and the three sections', () => {
    expect(existsSync(join(DIARY, 'README.md'))).toBe(true)
    const index = readFileSync(join(DIARY, 'README.md'), 'utf8')
    for (const phase of PHASES) {
      expect(index, phase).toContain(`${phase}.md`)
      const page = readFileSync(join(DIARY, `${phase}.md`), 'utf8')
      expect(page, phase).toMatch(new RegExp(`^# ${phase.toUpperCase()} · \\S`, 'm'))
      expect(page, phase).toMatch(/cost[^\n]*CRs?[^\n]*duration/i)
      for (const section of ['What changed', 'CRs', 'Lessons']) expect(page, `${phase} ${section}`).toMatch(new RegExp(`^## ${section}$`, 'm'))
      const changed = page.split(/^## What changed$/m)[1]?.split(/^## /m)[0] ?? ''
      expect(changed.split('\n').filter(line => /^[-*] /.test(line)).length, phase).toBeLessThanOrEqual(5)
      const lessons = page.split(/^## Lessons$/m)[1]?.split(/^## /m)[0] ?? ''
      expect(lessons.split('\n').filter(line => /^[-*] |^\d+\. /.test(line)).length, phase).toBeLessThanOrEqual(3)
    }
  })

  test('A66: nothing in the diary is a secret, a path under a home folder or an e-mail address', () => {
    // The path is live: the scanner catches each kind on a sample.
    expect(redactSecrets('token ghp_0123456789abcdefghijklmnopqrstuvwxyzAB')).not.toContain('ghp_0123456789abcdefghijklmnopqrstuvwxyzAB')
    const homePath = /(?:[A-Za-z]:\\Users\\[^\\\s]+|\/Users\/[^/\s]+|\/home\/[^/\s]+)/
    const email = /[\w.+-]+@[\w-]+\.[\w.-]+/
    expect('C:\\Users\\someone\\x').toMatch(homePath)
    const files = existsSync(DIARY) ? readdirSync(DIARY).filter(name => name.endsWith('.md')) : []
    expect(files.length).toBeGreaterThanOrEqual(PHASES.length + 1)
    for (const name of files) {
      const text = readFileSync(join(DIARY, name), 'utf8')
      expect(redactSecrets(text), name).toBe(text)
      expect(text, name).not.toMatch(homePath)
      expect(text, name).not.toMatch(email)
    }
  })
})
