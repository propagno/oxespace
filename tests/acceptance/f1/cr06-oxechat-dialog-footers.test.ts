// Frozen acceptance test for CR-06 (FRONTEND review of #608, OXE phase F1, A4). The executor must not edit it.
// The OxeChat dialogs put their buttons in the U1 footer API (`actions`), not a hand-built `footer`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const FILES = [
  'src/components/Threads/ThreadDialogs.tsx',
  'src/components/Threads/ThreadSidebar.tsx',
  'src/components/Threads/ThreadProjectSettingsDialog.tsx',
  'src/components/Threads/ThreadCommandDialog.tsx',
  'src/components/Threads/ProviderAccountsPanel.tsx',
  'src/components/Threads/ThreadWorktreeFinishDialog.tsx'
]

describe('CR-06 · OxeChat dialog footers are on U1 actions', () => {
  test.each(FILES)('%s renders no hand-built footer on <Dialog>', path => {
    const source = readFileSync(join(ROOT, path), 'utf8')
    const dialogs = [...source.matchAll(/<Dialog\b[\s\S]*?>/g)].map(match => match[0])
    for (const tag of dialogs) expect(tag).not.toMatch(/\sfooter=/)
  })
})
