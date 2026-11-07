// Frozen acceptance test for the 1.5.0 F1 close (OXE phase F1, task T13): CR-10, CR-12, CR-13, CR-14. The executor must not edit it.
// CR-10 (FRONTEND review of #616): U6 removed the sign-in card's own action, so its onAccounts prop is dead code
//         in both components that pass it down. The typecheck stays green without it.
// CR-12 (HML-F1-1): the pt-BR startup failure screen shows the raw English error under "Detalhes". The fold is labelled
//         as the technical message, so a Portuguese reader knows why it isn't translated.
// CR-13 (HML-F1-2): the screen's Quit/Sair is plain text at rest. Every text button has a visible shape at rest
//         (playground rule), so Quit is a secondary button, never ghost or link.
// CR-14 (HML-F1-3): Settings › Appearance › Dark still says "warm yellow accents" / "amarelo quente". C4 made the dark
//         accent caatinga green.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ErrorState } from '../../../src/ui'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
const json = (path: string): Record<string, any> => JSON.parse(read(path))

describe('CR-10 · the sign-in card has no dead onAccounts prop', () => {
  test.each(['src/components/Threads/ThreadFailureCard.tsx', 'src/components/Threads/ThreadTimelineEntry.tsx'])('%s no longer takes or passes onAccounts', path => {
    expect(read(path)).not.toMatch(/\bonAccounts\b/)
  })
  test('the conversation view still offers the accounts surface (only the dead prop went)', () => {
    expect(read('src/components/Threads/ThreadView.tsx')).toMatch(/\bonAccounts\b/)
  })
})

describe('CR-12 · the startup failure detail is labelled as the technical message', () => {
  test('ErrorState takes an optional label for its folded detail, and keeps the generic one by default', () => {
    const { unmount } = render(<ErrorState title="Failed" detail="SQLITE_CANTOPEN: unable to open database file" detailLabel="Technical message" />)
    expect(screen.getByText('Technical message')).toBeTruthy()
    expect(screen.getByText('SQLITE_CANTOPEN: unable to open database file')).toBeTruthy()
    unmount()
    render(<ErrorState title="Failed" detail="x" />)
    expect(document.querySelector('details summary')?.textContent?.trim().length).toBeGreaterThan(0)
  })
  test('the startup screen passes a translated technical-message label', () => {
    const source = read('src/components/Startup/StartupFailureScreen.tsx')
    expect(source).toMatch(/detailLabel=\{t\(['"]common:startupFailure\.technicalDetail['"]\)\}/)
    const en = json('shared/locales/en/common.json').startupFailure.technicalDetail
    const pt = json('shared/locales/pt-BR/common.json').startupFailure.technicalDetail
    expect(typeof en).toBe('string')
    expect(en).toMatch(/technical/i)
    expect(typeof pt).toBe('string')
    expect(pt).toMatch(/técnic/i)
    expect(pt).toMatch(/inglês/i)
  })
})

describe('CR-13 · Quit has a visible shape at rest', () => {
  test('the startup screen Quit button is not ghost or link (secondary, the default shape)', () => {
    const source = read('src/components/Startup/StartupFailureScreen.tsx')
    // The tag's attributes may hold arrows (`=>`), so read up to the '>' that is followed by the Quit label.
    const quit = /<Button\b((?:(?!<Button\b)[\s\S])*?)>\s*\{t\(['"]common:startupFailure\.quit['"]\)\}/.exec(source)
    expect(quit, 'the Quit button is a <Button> with the startupFailure.quit label').not.toBeNull()
    expect(quit![0]).not.toMatch(/variant=["'](ghost|link)["']/)
  })
})

describe('CR-14 · the Appearance copy names the caatinga accent', () => {
  const dark = (locale: string): string => {
    const settings = json(`shared/locales/${locale}/settings.json`)
    const found: string[] = []
    const walk = (node: unknown): void => {
      if (node && typeof node === 'object') for (const value of Object.values(node as Record<string, unknown>)) walk(value)
      else if (typeof node === 'string') found.push(node)
    }
    walk(settings)
    return found.join('\n')
  }
  test('no settings copy still promises yellow accents', () => {
    expect(dark('en')).not.toMatch(/warm yellow accents/i)
    expect(dark('pt-BR')).not.toMatch(/amarelo quente/i)
  })
  test('the dark theme hint names caatinga green in both languages', () => {
    expect(read('shared/locales/en/settings.json')).toMatch(/"hint":\s*"Dark surfaces with caatinga green accents"/)
    expect(read('shared/locales/pt-BR/settings.json')).toMatch(/"hint":\s*"Superfícies escuras com detalhes em verde caatinga"/)
  })
})
