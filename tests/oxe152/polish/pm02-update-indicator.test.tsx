// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-250, PM-02·13, CA-1 and CA-2; brand-approved POLISH-02 #13,
// adjusted by the brand: a ghost --control-sm button; the alias part does not apply after T18). Written by the planner;
// the executor must not edit it.
// Today (main 4b7015c89) src/styles/base.css forces .app-update-trigger to 28×28 with a border, a canvas background and an
// --accent outline, so the update chip looks like no other title bar icon.
// Contract:
// - With an update available, AppUpdateIndicator's trigger is the src/ui Button or IconButton (data-ui "button" or "icon-button"), ghost, size sm
//   (data-size="sm", --control-sm), named by the chip's label; nothing in the indicator carries an inline style.
// - SOURCE-TEXT checks (marked; the e2e spec pm-02-13 measures 24px in the built app): src/styles/base.css has no
//   .app-update-trigger rule any more; a new src/components/Updates/AppUpdateIndicator.module.css styles the trigger with
//   no border and no fixed width or height, var(--radius-sm), and a :focus-visible ring of var(--focus-ring) (never
//   --accent).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppUpdateIndicator } from '../../../src/components/Updates/AppUpdateIndicator'
import { useUpdaterStore } from '../../../src/store/updater.store'
import { useApprovalsStore } from '../../../src/components/Approvals/approvals.store'
import { changeLanguage, i18n } from '../../../src/i18n'

const ROOT = process.cwd()
const MODULE = join(ROOT, 'src/components/Updates/AppUpdateIndicator.module.css')
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '')

beforeEach(async () => {
  await changeLanguage('en')
  useApprovalsStore.setState({ queue: [] } as never)
  useUpdaterStore.setState({ app: { status: 'available', installMode: 'manual', currentVersion: '1.5.1', availableVersion: '9.9.9', progress: null, error: null, lastCheckedAt: 1 }, dismissedVersion: null } as never)
})
afterEach(() => { cleanup() })

describe('OXE-250 PM-02·13 the update indicator is a ghost icon button like the others', () => {
  it('the trigger is the ghost sm Button named by the chip, with no inline style anywhere', () => {
    const { container } = render(<AppUpdateIndicator />)
    const trigger = screen.getByRole('button', { name: i18n.t('updates.chip.available', { version: '9.9.9' }) })
    expect(['button', 'icon-button']).toContain(trigger.getAttribute('data-ui'))
    expect(trigger).toHaveAttribute('data-size', 'sm')
    expect(trigger.getAttribute('data-variant') ?? 'ghost').toBe('ghost')
    expect(container.querySelectorAll('[style]'), 'no inline style').toHaveLength(0)
  })

  it('base.css no longer styles the trigger; its own module has no border, no fixed size and the --focus-ring ring (source text, marked)', () => {
    expect(strip(readFileSync(join(ROOT, 'src/styles/base.css'), 'utf8'))).not.toMatch(/\.app-update-trigger\b/)
    expect(existsSync(MODULE), 'AppUpdateIndicator.module.css').toBe(true)
    const css = strip(readFileSync(MODULE, 'utf8'))
    expect(css).not.toMatch(/(^|[;\s{])border\s*:\s*(?!0|none)[^;]+/)
    expect(css).not.toMatch(/(^|[;\s{])(width|height)\s*:\s*\d+px/)
    expect(css).toMatch(/border-radius\s*:\s*var\(--radius-sm\)/)
    const focus = [...css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^{}]*)\}/g)].map(match => match[2]).join(';')
    expect(focus).toMatch(/var\(--focus-ring\)/)
    expect(focus).not.toMatch(/var\(--accent\)/)
  })
})
