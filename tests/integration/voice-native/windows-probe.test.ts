/**
 * OxeVoice F1 · A5 — frozen acceptance test (written by the plan, before execution; do not edit).
 * The real helper script, run by the real Windows PowerShell 5.1 in probe mode: it loads the WinRT speech API,
 * touches no microphone and answers one `probe` line. Windows only (other OSes skip).
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWindowsWinrtEngine, killProcessTree } from '../../../electron/main/services/voice/windows-helper'

const SCRIPT = resolve(__dirname, '../../../resources/voice/windows-dictation.ps1')

describe('windows helper script (A5)', () => {
  it('ships in resources and never builds code from strings', () => {
    expect(existsSync(SCRIPT)).toBe(true)
    const source = readFileSync(SCRIPT, 'utf8')
    expect(source).toMatch(/param\s*\(/i)
    expect(source).toMatch(/Windows\.Media\.SpeechRecognition/)
    expect(source).toMatch(/0x80045509|2147199735|-2147199735/i)
    // No dynamic code: the helper is a fixed program, not an evaluator.
    expect(source).not.toMatch(/Invoke-Expression|\biex\b|\[ScriptBlock\]::Create|Add-Type\s+-TypeDefinition|DownloadString|Invoke-WebRequest|Start-BitsTransfer/i)
  })

  it.runIf(process.platform === 'win32')('probes WinRT speech on this Windows without a microphone', async () => {
    const env: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(process.env)) if (!/^OXESPACE_/i.test(key)) env[key] = value
    const engine = createWindowsWinrtEngine({ spawn, scriptPath: SCRIPT, killTree: killProcessTree, env })
    const started = Date.now()
    const result = await engine.probe()
    expect(Date.now() - started).toBeLessThan(20_000)
    expect(typeof result.available).toBe('boolean')
    expect(Array.isArray(result.languages)).toBe(true)
    if (result.available) {
      expect(result.languages.length).toBeGreaterThan(0)
      expect(result.languages.every(tag => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag))).toBe(true)
      expect(result.reason).toBeNull()
    } else {
      expect(result.reason).not.toBeNull()
    }
  }, 30_000)
})
