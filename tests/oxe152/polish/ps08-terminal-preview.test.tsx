// Acceptance test for 1.5.2 Polimento · Configurações (Jira OXE-234, PS-08·3, CA-1 & CA-2).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsContent } from '../../../src/components/Settings/SettingsModal'
import { changeLanguage } from '../../../src/i18n'

const PROPS = {
  agentProfiles: [],
  agentReadiness: [],
  isDiscoveringAgents: false,
  onClose: vi.fn(),
  onDiscoverAgents: vi.fn(),
  onConfigureAgent: vi.fn(),
  onNewCustomAgent: vi.fn()
}

afterEach(async () => {
  cleanup()
  await changeLanguage('en')
})

describe('OXE-234 (PS-08·3): terminal preview without traffic light or uppercase', () => {
  it('the terminal preview has no three-dot traffic light', () => {
    const { container } = render(<SettingsContent section="terminal" {...PROPS} />)
    const chrome = container.querySelector('.settings-term-preview-chrome')
    expect(chrome).not.toBeNull()
    expect(chrome!.querySelectorAll('span')).toHaveLength(0)

    const css = readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8')
    expect(css).not.toMatch(/\.settings-term-preview-chrome\s+span/)
  })

  it('[css] the preview label is --fs-xs, --weight-medium, --tx-muted, no text-transform or letter-spacing, and reads Prévia do terminal in pt-BR', async () => {
    await changeLanguage('pt-BR')
    const { container } = render(<SettingsContent section="terminal" {...PROPS} />)
    const label = container.querySelector('.settings-term-preview-chrome em')
    expect(label).not.toBeNull()
    expect(label!.textContent).toBe('Prévia do terminal')

    const css = readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8')
    const rule = css.match(/\.settings-term-preview-chrome\s+em\s*\{([^}]*)\}/)
    expect(rule, '.settings-term-preview-chrome em rule exists').not.toBeNull()
    const body = rule![1]
    expect(body).toContain('font-size: var(--fs-xs)')
    expect(body).toContain('font-weight: var(--weight-medium)')
    expect(body).toContain('color: var(--tx-muted)')
    expect(body).not.toMatch(/text-transform\s*:/)
    expect(body).not.toMatch(/letter-spacing\s*:/)
  })
})
