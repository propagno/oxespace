/**
 * OxeVoice 1.5 · builds the voice runtime (registry + consent store). Loaded lazily with `await import()` on the
 * first voice:* call, so the voice service stays out of the static main entry. Does not import `electron` and has
 * no fs of its own: consent persists through consent-file.ts; every path and the platform are injected.
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createVoiceConsentStore } from './consent'
import type { VoiceConsentStore } from './consent'
import { createVoiceConsentFile } from './consent-file'
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

  const consent = createVoiceConsentStore(createVoiceConsentFile(userDataPath))

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
