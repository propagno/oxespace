/**
 * OxeVoice 1.5 · persistent, revocable consent for engines that send audio off the machine.
 * A grant is dated and tied to the version of the text the person accepted: a new text version asks again.
 */
import type { VoiceEngineId } from '../../../../shared/types/ipc/voice'

/** Bump when the consent text changes, so earlier grants stop counting. */
export const VOICE_CONSENT_TEXT_VERSION = '2026-11-01'

export interface VoiceConsentRecord {
  engineId: VoiceEngineId
  grantedAt: string
  textVersion: string
}

export interface VoiceConsentStorage {
  read(): string | null
  write(data: string): void
}

export interface VoiceConsentStore {
  get(engineId: VoiceEngineId): VoiceConsentRecord | null
  grant(engineId: VoiceEngineId): VoiceConsentRecord
  revoke(engineId: VoiceEngineId): void
  isGranted(engineId: VoiceEngineId): boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAll(storage: VoiceConsentStorage): Record<string, unknown> {
  try {
    const raw = storage.read()
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function toRecord(engineId: VoiceEngineId, value: unknown): VoiceConsentRecord | null {
  if (!isRecord(value)) return null
  if (typeof value.grantedAt !== 'string' || typeof value.textVersion !== 'string') return null
  return { engineId, grantedAt: value.grantedAt, textVersion: value.textVersion }
}

export function createVoiceConsentStore(
  storage: VoiceConsentStorage,
  options: { now?: () => Date } = {}
): VoiceConsentStore {
  const now = options.now ?? (() => new Date())

  const get = (engineId: VoiceEngineId): VoiceConsentRecord | null => toRecord(engineId, readAll(storage)[engineId])

  return {
    get,
    grant(engineId) {
      const record: VoiceConsentRecord = {
        engineId,
        grantedAt: now().toISOString(),
        textVersion: VOICE_CONSENT_TEXT_VERSION
      }
      storage.write(JSON.stringify({ ...readAll(storage), [engineId]: record }))
      return record
    },
    revoke(engineId) {
      const all = readAll(storage)
      delete all[engineId]
      storage.write(JSON.stringify(all))
    },
    isGranted(engineId) {
      return get(engineId)?.textVersion === VOICE_CONSENT_TEXT_VERSION
    }
  }
}
