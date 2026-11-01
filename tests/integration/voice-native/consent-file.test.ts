/**
 * OxeVoice F1 · CR-12 (fs-allowlist) — frozen acceptance test, written by the planner before execution.
 * Consent persists through one isolated, allowlisted module (`consent-file.ts`, TECH LEAD option (a)); bootstrap and
 * registry never touch fs. TECH LEAD conditions: fail closed (missing, unreadable, >4 KB, wrong schema, old text
 * version → no consent, never a throw), atomic write (tmp + rename in the same directory), closed content
 * `{ schema: 1, grants: { <engine>: { engineId, grantedAt, textVersion } } }` with nothing else, and a revoke that
 * makes the next instance ask again.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createVoiceConsentStore, VOICE_CONSENT_TEXT_VERSION } from '../../../electron/main/services/voice/consent'
import { createVoiceConsentFile, VOICE_CONSENT_FILE, VOICE_CONSENT_MAX_BYTES } from '../../../electron/main/services/voice/consent-file'

let dir: string
const file = () => join(dir, VOICE_CONSENT_FILE)
const store = () => createVoiceConsentStore(createVoiceConsentFile(dir), { now: () => new Date('2026-11-01T10:00:00.000Z') })

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'oxe-voice-consent-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('voice consent file (CR-12)', () => {
  it('uses a fixed file name under userData and a 4 KB cap', () => {
    expect(VOICE_CONSENT_FILE).toBe('voice-consent.json')
    expect(VOICE_CONSENT_MAX_BYTES).toBe(4096)
  })

  it('a missing file is no consent', () => {
    expect(createVoiceConsentFile(dir).read()).toBeNull()
    expect(store().isGranted('windows-winrt')).toBe(false)
  })

  it('a grant persists across instances with closed content only', () => {
    store().grant('windows-winrt')
    expect(store().isGranted('windows-winrt')).toBe(true)
    const disk = JSON.parse(readFileSync(file(), 'utf8'))
    expect(disk).toEqual({
      schema: 1,
      grants: { 'windows-winrt': { engineId: 'windows-winrt', grantedAt: '2026-11-01T10:00:00.000Z', textVersion: VOICE_CONSENT_TEXT_VERSION } }
    })
  })

  it('revoking makes the next instance ask again', () => {
    store().grant('windows-winrt')
    store().revoke('windows-winrt')
    expect(store().isGranted('windows-winrt')).toBe(false)
    expect(JSON.stringify(JSON.parse(readFileSync(file(), 'utf8')))).not.toContain('windows-winrt')
  })

  it('a corrupted file is no consent, never a throw, and a new grant replaces it', () => {
    writeFileSync(file(), '{ not json', 'utf8')
    expect(() => store().isGranted('windows-winrt')).not.toThrow()
    expect(store().isGranted('windows-winrt')).toBe(false)
    store().grant('windows-winrt')
    expect(store().isGranted('windows-winrt')).toBe(true)
  })

  it('a file over 4 KB is no consent', () => {
    const grant = { engineId: 'windows-winrt', grantedAt: '2026-11-01T10:00:00.000Z', textVersion: VOICE_CONSENT_TEXT_VERSION }
    writeFileSync(file(), JSON.stringify({ schema: 1, grants: { 'windows-winrt': grant } }) + ' '.repeat(VOICE_CONSENT_MAX_BYTES), 'utf8')
    expect(store().isGranted('windows-winrt')).toBe(false)
  })

  it('a wrong schema or any extra field is no consent', () => {
    const grant = { engineId: 'windows-winrt', grantedAt: '2026-11-01T10:00:00.000Z', textVersion: VOICE_CONSENT_TEXT_VERSION }
    writeFileSync(file(), JSON.stringify({ schema: 2, grants: { 'windows-winrt': grant } }), 'utf8')
    expect(store().isGranted('windows-winrt')).toBe(false)
    writeFileSync(file(), JSON.stringify({ schema: 1, grants: { 'windows-winrt': { ...grant, transcript: 'hello' } } }), 'utf8')
    expect(store().isGranted('windows-winrt')).toBe(false)
    writeFileSync(file(), JSON.stringify({ schema: 1, grants: { 'windows-winrt': grant }, device: 'mic-1' }), 'utf8')
    expect(store().isGranted('windows-winrt')).toBe(false)
  })

  it('a grant for an older text version is no consent', () => {
    const grant = { engineId: 'windows-winrt', grantedAt: '2026-01-01T00:00:00.000Z', textVersion: 'v0-old' }
    writeFileSync(file(), JSON.stringify({ schema: 1, grants: { 'windows-winrt': grant } }), 'utf8')
    expect(store().isGranted('windows-winrt')).toBe(false)
  })

  it('an unreadable file is no consent, never a throw', () => {
    mkdirSync(file())
    expect(() => createVoiceConsentFile(dir).read()).not.toThrow()
    expect(store().isGranted('windows-winrt')).toBe(false)
  })

  it('writes atomically: tmp + rename in the same directory, no leftovers', () => {
    store().grant('windows-winrt')
    expect(readdirSync(dir)).toEqual([VOICE_CONSENT_FILE])
    const source = readFileSync(resolve(__dirname, '../../../electron/main/services/voice/consent-file.ts'), 'utf8')
    expect(source).toMatch(/renameSync/)
  })

  it('creates userData when it does not exist yet', () => {
    const nested = join(dir, 'fresh', 'userData')
    createVoiceConsentStore(createVoiceConsentFile(nested)).grant('windows-winrt')
    expect(existsSync(join(nested, VOICE_CONSENT_FILE))).toBe(true)
  })

  it('bootstrap persists consent through the consent file, with no fs import of its own', () => {
    const source = readFileSync(resolve(__dirname, '../../../electron/main/services/voice/bootstrap.ts'), 'utf8')
    expect(source).not.toMatch(/from 'node:fs'|from 'fs'|require\('(node:)?fs'\)/)
    expect(source).toMatch(/createVoiceConsentFile/)
  })
})
