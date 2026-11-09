// Frozen acceptance test for the 1.5.0 cockpit item R11 backend side (OXE program, phase F2): with Monaco read-only,
// fs:write-file and its writer go; reading, listing and watching stay. Written by the planner; the executor must not
// edit it. Static checks only. Paired with FE-R11.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('R11 (backend) · no file writer behind the read-only editor', () => {
  test('R11: IPC_CHANNELS.fs has no writeFile, and keeps reading, listing and watching', async () => {
    const { IPC_CHANNELS } = await import('../../../shared/types/ipc')
    expect(Object.keys(IPC_CHANNELS.fs)).not.toContain('writeFile')
    for (const key of ['listTree', 'readFile', 'watchFile', 'unwatchFile']) expect(Object.keys(IPC_CHANNELS.fs), key).toContain(key)
  })

  test('R11: FileSystemService has no writeFile, and the preload exposes none', () => {
    expect(read('electron/main/services/file-system.service.ts')).not.toMatch(/\bwriteFile\s*\(\s*input\s*:/)
    expect(read('electron/preload/api.ts')).not.toMatch(/IPC_CHANNELS\.fs\.writeFile/)
  })
})
