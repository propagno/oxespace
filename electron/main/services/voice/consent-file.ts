/**
 * OxeVoice 1.5 · the only place voice consent touches the filesystem (CR-12).
 * One fixed file, <userData>/voice-consent.json, 4 KB at most, with closed content
 * `{ schema: 1, grants: { <engine>: { engineId, grantedAt, textVersion } } }` and nothing else.
 * Reads fail closed (missing, unreadable, too big, wrong shape -> no consent, never a throw);
 * writes are atomic (temporary file beside it, then rename). Does not import `electron`: the
 * directory is injected and never comes from IPC.
 */
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VoiceConsentStorage } from './consent'

export const VOICE_CONSENT_FILE = 'voice-consent.json'
export const VOICE_CONSENT_MAX_BYTES = 4096

const SCHEMA = 1
const GRANT_KEYS = ['engineId', 'grantedAt', 'textVersion']

type Grants = Record<string, { engineId: string; grantedAt: string; textVersion: string }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(value)
  return own.length === keys.length && keys.every(key => own.includes(key))
}

/** Returns the grants of a closed, valid file content, or null when anything is off. */
function parseGrants(raw: string): Grants | null {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || !hasOnlyKeys(parsed, ['schema', 'grants'])) return null
  if (parsed.schema !== SCHEMA || !isRecord(parsed.grants)) return null
  const grants: Grants = {}
  for (const [key, value] of Object.entries(parsed.grants)) {
    if (!isRecord(value) || !hasOnlyKeys(value, GRANT_KEYS)) return null
    if (value.engineId !== key) return null
    if (typeof value.grantedAt !== 'string' || typeof value.textVersion !== 'string') return null
    grants[key] = { engineId: key, grantedAt: value.grantedAt, textVersion: value.textVersion }
  }
  return grants
}

/** Keeps only well-formed grants from what the consent store hands over (a map of engine -> record). */
function sanitizeGrants(data: string): Grants {
  const grants: Grants = {}
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return grants
  }
  if (!isRecord(parsed)) return grants
  for (const [key, value] of Object.entries(parsed)) {
    if (!isRecord(value)) continue
    if (typeof value.grantedAt !== 'string' || typeof value.textVersion !== 'string') continue
    grants[key] = { engineId: key, grantedAt: value.grantedAt, textVersion: value.textVersion }
  }
  return grants
}

export function createVoiceConsentFile(userDataPath: string): VoiceConsentStorage {
  const file = join(userDataPath, VOICE_CONSENT_FILE)

  return {
    read() {
      try {
        if (statSync(file).size > VOICE_CONSENT_MAX_BYTES) return null
        const grants = parseGrants(readFileSync(file, 'utf8'))
        return grants ? JSON.stringify(grants) : null
      } catch {
        return null // any read problem means no consent
      }
    },
    write(data) {
      mkdirSync(userDataPath, { recursive: true })
      const content = JSON.stringify({ schema: SCHEMA, grants: sanitizeGrants(data) })
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      try {
        writeFileSync(tmp, content, 'utf8')
        renameSync(tmp, file)
      } catch (error) {
        try {
          unlinkSync(tmp)
        } catch {
          // nothing to clean up
        }
        throw error
      }
    }
  }
}
