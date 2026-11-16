// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-213, PU-03·11, CA-2 as narrowed by the coordination on
// 15/11: the version shows in About, never in the status bar). Written by the planner; the executor must not edit it.
// Runs after the card's backend task (src/lib/appVersion.ts, the __APP_VERSION__ define) and after T36 (BRD-23 rebuilds
// Settings; About stays a page of it).
// Today (main 4b7015c89) Settings › About labels the version "dev build" whenever the updater reports currentVersion
// "dev" or nothing (every development and test build), and AppStatusBar hard-codes "1.5.0" as its fallback.
// Contract:
// - SettingsContent section "about" shows `v<APP_VERSION>` (package.json's version) when the updater's currentVersion is
//   "dev" or empty, and `v<currentVersion>` when the updater knows a real one.
// - The status bar shows no version at all (BRD-09 / OXE-72 CA-4): no APP_VERSION, no "1.5.0", no "OXESpace <n>".
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsContent } from '../../../src/components/Settings/SettingsModal'
import { AppStatusBar } from '../../../src/components/Workspace/AppStatusBar'
import { useUpdaterStore } from '../../../src/store/updater.store'
import { APP_VERSION } from '../../../src/lib/appVersion'
import { changeLanguage } from '../../../src/i18n'

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }
const about = (): void => {
  render(<SettingsContent section="about" agentProfiles={[]} agentReadiness={[]} isDiscoveringAgents={false} onClose={vi.fn()} onDiscoverAgents={vi.fn()} onConfigureAgent={vi.fn()} onNewCustomAgent={vi.fn()} />)
}
const updater = (currentVersion: string): void => {
  useUpdaterStore.setState({ app: { status: 'disabled', currentVersion, availableVersion: null, progress: null, error: null, lastCheckedAt: null } } as never)
}

beforeEach(async () => { await changeLanguage('en') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OXE-213 PU-03·11 the installed version in About, never in the status bar', () => {
  it.each(['dev', ''])('About shows v<package.json version> when the updater says "%s"', current => {
    expect(APP_VERSION).toBe(pkg.version)
    updater(current)
    about()
    expect(screen.getAllByText(`v${pkg.version}`).length).toBeGreaterThan(0)
  })

  it('About shows the updater\'s own version when it knows one', () => {
    updater('9.8.7')
    about()
    expect(screen.getAllByText('v9.8.7').length).toBeGreaterThan(0)
  })

  it('the status bar names no version', () => {
    const { container } = render(<AppStatusBar appVersion="dev" workspace={null} activePaneId={null} />)
    const text = container.textContent ?? ''
    expect(text).not.toContain(pkg.version)
    expect(text).not.toContain('1.5.0')
    expect(text).not.toMatch(/OXESpace\s+\d/)
  })
})
