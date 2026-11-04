// Frozen acceptance test for 1.5.0 A5 (U6, OXE phase F1), version 2 (CR-09, spec gap). The executor must not edit it.
// Decision D-F1-1: the "Callout" of the plan is the existing ui Notice (info/warning/danger, icon, actions). U6 puts it in its four places.
// CR-09: the sign-in card carries NO Reconnect action (the composer account notice owns it; main removed the duplicate on
// purpose), and a policy file with an error is a warning Notice (its rules are not in force).
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
    ['the workspace policy without a file', 'src/components/Settings/PolicySettings.tsx', 'info'],
    ['the workspace policy file with an error', 'src/components/Settings/PolicySettings.tsx', 'warning']
  ])('%s', (_name, path, intent) => {
    const source = read(path)
    expect(source).toMatch(/import\s*\{[^}]*\bNotice\b[^}]*\}\s*from\s*['"][./]*ui['"]/)
    expect(source).toMatch(new RegExp(`<Notice[^>]*intent=["']${intent}["']`))
  })

  test('a policy file with an error says so in a warning Notice, not a plain paragraph', () => {
    const source = read('src/components/Settings/PolicySettings.tsx')
    expect(source).toMatch(/<Notice[^>]*intent=["']warning["'][^>]*>[^<]*t\(['"]policy\.fileError['"]\)/)
    expect(source).not.toMatch(/<p>\s*\{t\(['"]policy\.fileError['"]\)\}\s*<\/p>/)
  })

  test('the OxeChat sign-in failure is one danger Notice with no action of its own and no bottom bar', () => {
    const source = read('src/components/Threads/ThreadFailureCard.tsx')
    const notices = source.match(/<Notice\b[^>]*>/g) ?? []
    expect(notices.length).toBe(1)
    expect(notices[0]).not.toMatch(/actions=/)
    expect(source).not.toMatch(/failureBottomBar|bottom-bar|bottomBar/)
  })
})
