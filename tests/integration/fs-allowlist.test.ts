import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const ALLOWED_FS_IMPORTS = new Set([
  'electron/main/services/file-system.service.ts',
  'electron/main/services/agent.service.ts',
  'electron/main/services/background.service.ts',
  'electron/main/services/git.service.ts',
  'electron/main/services/github.service.ts',
  'electron/main/services/session.service.ts',
  'electron/main/services/shell-profile.service.ts',
  'electron/main/services/skill.service.ts',
  'electron/main/services/terminal.service.ts',
  'electron/main/services/usage/claudeProvider.ts',
  'electron/main/services/usage/codexProvider.ts',
  'electron/main/index.ts',
  'electron/main/db/index.ts'
])

describe('workspace fs allowlist', () => {
  test('keeps workspace filesystem operations in FileSystemService', async () => {
    const root = process.cwd()
    const files = await listFiles(join(root, 'electron'))
    const offenders: string[] = []

    for (const file of files) {
      const rel = relative(root, file).replaceAll('\\', '/')
      if (!rel.endsWith('.ts')) continue
      const source = await readFile(file, 'utf8')
      const importsFs = /from ['"]node:fs/.test(source) || /from ['"]fs/.test(source)
      if (importsFs && !ALLOWED_FS_IMPORTS.has(rel)) {
        offenders.push(rel)
      }
    }

    expect(offenders).toEqual([])
  })
})

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(fullPath) : [fullPath]
    })
  )
  return files.flat()
}
