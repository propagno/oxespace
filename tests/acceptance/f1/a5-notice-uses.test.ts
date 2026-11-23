// Frozen acceptance test for 1.5.0 A5 (U6, OXE phase F1), version 3 (CR-09, CR-11, spec gaps). The executor must not edit it.
// Decision D-F1-1: the "Callout" of the plan is the existing ui Notice (info/warning/danger, icon, actions). U6 puts it in its four places.
// CR-09, released by LOGIN A (user 22/11, OXE-388): the sign-in card is the failure's one owner: no Notice, one Reconnect, still one danger alert.
// CR-11: one alert per problem. The policy page already shows a warning Notice per problem ("Not applied: …"), so the file
// card's "this file has an error" stays plain text: two alerts for one problem was a strict-mode e2e failure and noise.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

describe('A5 · the four Callout places use the ui Notice with the right intent', () => {
  test.each([
    ['accounts that failed', 'src/components/Threads/ProviderAccountsPanel.tsx', 'danger'],
    // liberação de teste congelado: coordenação 22/11, LOGIN A (usuário, OXE-388): the sign-in row moved to its own cases below
    ['the workspace policy without a file', 'src/components/Settings/PolicySettings.tsx', 'info'],
    ['a workspace policy problem (page level)', 'src/components/Settings/PolicySettings.tsx', 'warning']
  ])('%s', (_name, path, intent) => {
    const source = read(path)
    expect(source).toMatch(/import\s*\{[^}]*\bNotice\b[^}]*\}\s*from\s*['"][./]*ui['"]/)
    expect(source).toMatch(new RegExp(`<Notice[^>]*intent=["']${intent}["']`))
  })

  test('a policy problem is announced once: the file card does not repeat it as a second alert', () => {
    const source = read('src/components/Settings/PolicySettings.tsx')
    expect(source).not.toMatch(/<Notice[^>]*intent=["'](warning|danger)["'][^>]*>[^<]*t\(['"]policy\.fileError['"]\)/)
    expect(source).toMatch(/t\(['"]policy\.fileError['"]\)/)
  })

  // liberação de teste congelado: coordenação 22/11, LOGIN A (usuário, OXE-388)
  test('the OxeChat sign-in failure is announced once, as danger', () => {
    const source = read('src/components/Threads/ThreadFailureCard.tsx')
    expect((source.match(/role=(["']alert["']|\{[^}]*["']alert["'][^}]*\})/g) ?? []).length).toBe(1)
    expect(read('src/components/Threads/ThreadFailureCard.css')).toMatch(/\.thread-failure-card[^{]*\{[^}]*--intent-danger-/)
  })

  // liberação de teste congelado: coordenação 22/11, LOGIN A (usuário, OXE-388)
  test('the OxeChat sign-in failure is one card with no Notice, one Reconnect and no bottom bar', () => {
    const source = read('src/components/Threads/ThreadFailureCard.tsx')
    expect(source).not.toMatch(/\bNotice\b/)
    expect((source.match(/t\(['"]view\.reconnect['"]\)/g) ?? []).length).toBe(1)
    expect(source).toMatch(/\bonResend\s*&&\s*<Button\b/)
    expect(source).not.toMatch(/failureBottomBar|bottom-bar|bottomBar/)
  })
})
