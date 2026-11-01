/**
 * OxeVoice 1.5 · builds the voice runtime (registry + consent store). Loaded lazily with `await import()` on the
 * first voice:* call, so the voice service stays out of the static main entry. Does not import `electron`: every
 * path and the platform are injected.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createVoiceConsentStore } from './consent'
import type { VoiceConsentStore } from './consent'
import { createVoiceRegistry } from './registry'
import type { VoiceRegistry } from './registry'
import type { VoiceEngine } from './types'
import { createWindowsWinrtEngine, killProcessTree } from './windows-helper'

export interface CreateVoiceRuntimeOptions {
  platform: NodeJS.Platform
  resourcesPath: string
  userDataPath: string
  env: NodeJS.ProcessEnv
}

export interface VoiceRuntime {
  registry: VoiceRegistry
  consent: VoiceConsentStore
}

export function createVoiceRuntime(options: CreateVoiceRuntimeOptions): VoiceRuntime {
  const { platform, resourcesPath, userDataPath, env } = options
  const consentFile = join(userDataPath, 'voice-consent.json')

  const consent = createVoiceConsentStore({
    read: () => {
      try {
        return readFileSync(consentFile, 'utf8')
      } catch {
        return null // a read error means no consent
      }
    },
    write: data => {
      mkdirSync(dirname(consentFile), { recursive: true })
      writeFileSync(consentFile, data, 'utf8')
    }
  })

  const engines: VoiceEngine[] = []
  if (platform === 'win32') {
    engines.push(
      createWindowsWinrtEngine({
        spawn,
        scriptPath: join(resourcesPath, 'voice', 'windows-dictation.ps1'),
        killTree: killProcessTree,
        env
      })
    )
  }

  const registry = createVoiceRegistry({ platform, consent, engines })
  return { registry, consent }
}
