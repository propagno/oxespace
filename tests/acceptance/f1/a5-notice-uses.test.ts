// Frozen acceptance test for 1.5.0 A5 (U6, OXE phase F1). The executor must not edit it.
// Decision D-F1-1: the "Callout" of the plan is the existing ui Notice (info/warning/danger, icon, actions). U6 puts it in its four places.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

describe('A5 · the four Callout places use the ui Notice with the right intent', () => {
  test.each([
    ['accounts that failed', 'src/components/Threads/ProviderAccountsPanel.tsx', 'danger'],
    ['the OxePost environments secrets', 'src/components/OxePost/EnvironmentsDialog.tsx', 'warning'],
    ['the OxeChat sign-in failure', 'src/components/Threads/ThreadFailureCard.tsx', 'danger'],
    ['the workspace policy file', 'src/components/Settings/PolicySettings.tsx', 'info']
  ])('%s', (_name, path, intent) => {
    const source = read(path)
    expect(source).toMatch(/import\s*\{[^}]*\bNotice\b[^}]*\}\s*from\s*['"][./]*ui['"]/)
    expect(source).toMatch(new RegExp(`<Notice[^>]*intent=["']${intent}["']`))
  })

  test('the OxeChat sign-in failure has one danger Notice with a Reconnect action and no bottom bar', () => {
    const source = read('src/components/Threads/ThreadFailureCard.tsx')
    expect((source.match(/<Notice\b/g) ?? []).length).toBe(1)
    expect(source).toMatch(/actions=\{/)
    expect(source).not.toMatch(/failureBottomBar|bottom-bar|bottomBar/)
  })
})
