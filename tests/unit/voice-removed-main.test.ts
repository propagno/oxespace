// @vitest-environment node
/**
 * B21 · OXEVoice left the main process (user decision, 31/10): no voice channel or preload API, no whisper engine in
 * the source or the package, no microphone permission. `<userData>/models` held OXEVoice's ggml files and the model of
 * semantic search, which R2 removed in 1.5.0: nothing in main opens that folder any more, so an upgrade leaves it and
 * every file in it as they were (the 1.4.0 notes, #449, tell the person to delete the `ggml-*` files by hand).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '../../shared/types/ipc'

const repo = process.cwd()
const read = (rel: string) => readFileSync(join(repo, rel), 'utf8')

function sources(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'vendor') found.push(...sources(path)) } else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry.name)) found.push(path)
  }
  return found
}

describe('B21: OXEVoice is gone from main, the preload and the package', () => {
  test('no voice channel and no voice API in the preload', () => {
    expect(Object.keys(IPC_CHANNELS)).not.toContain('voice')
    expect(read('shared/types/ipc.ts')).not.toMatch(/['"]voice:/)
    expect(read('electron/preload/api.ts')).not.toMatch(/IPC_CHANNELS\.voice|\bvoice:\s*\{/)
    expect(existsSync(join(repo, 'shared/types/voice.ts'))).toBe(false)
  })

  test('no main source names whisper or a ggml model, and none opens <userData>/models (R2 removed its last reader)', () => {
    const offenders: string[] = []
    const modelsUsers: string[] = []
    for (const file of [...sources(join(repo, 'electron/main')), ...sources(join(repo, 'electron/preload'))]) {
      const text = readFileSync(file, 'utf8')
      const rel = relative(repo, file).replace(/\\/g, '/')
      if (/whisper|ggml/i.test(text)) offenders.push(rel)
      if (/getPath\('userData'\)[^\n]*'models'/.test(text)) modelsUsers.push(rel)
    }
    expect(offenders).toEqual([])
    expect(modelsUsers).toEqual([])
  })

  test('the package carries no whisper engine', () => {
    expect(read('electron-builder.yml')).not.toMatch(/whisper/i)
    expect(read('package.json')).not.toMatch(/whisper/i)
    expect(existsSync(join(repo, 'resources/whisper'))).toBe(false)
  })

  test('the window no longer grants the microphone or camera', () => {
    const allowed = /const ALLOWED_PERMISSIONS = new Set\(\[([^\]]*)\]\)/.exec(read('electron/main/index.ts'))
    expect(allowed?.[1]).toBeDefined()
    expect(allowed![1]).not.toMatch(/'media'/)
    expect(allowed![1]).toMatch(/'clipboard-read'/)
  })
})
