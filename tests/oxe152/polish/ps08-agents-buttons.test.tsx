import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentProfile, AgentReadiness } from '../../../shared/types/agent'
import { SettingsContent } from '../../../src/components/Settings/SettingsModal'

const componentsCss = readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8')

const PROFILES: AgentProfile[] = [
  {
    agentProfileId: 'p-claude',
    provider: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    isBuiltin: true
  },
  {
    agentProfileId: 'p-codex',
    provider: 'codex',
    name: 'Codex',
    command: 'codex',
    args: [],
    isBuiltin: true
  }
]

const READINESS: AgentReadiness[] = [
  { provider: 'claude', status: 'ready', command: 'claude', checkedAt: Date.now() },
  { provider: 'codex', status: 'ready', command: 'codex', checkedAt: Date.now() }
]

afterEach(() => {
  cleanup()
})

function renderAgentsSettings() {
  return render(
    <SettingsContent
      section="providers"
      agentProfiles={PROFILES}
      agentReadiness={READINESS}
      isDiscoveringAgents={false}
      onClose={vi.fn()}
      onDiscoverAgents={vi.fn()}
      onConfigureAgent={vi.fn()}
      onNewCustomAgent={vi.fn()}
      onUseProviderInPane={vi.fn()}
    />
  )
}

describe('OXE-239 · PS-08·12 Agents settings never show multiple primary buttons', () => {
  test('with two or more ready providers, Use in pane is a secondary sm Button', () => {
    const { container } = renderAgentsSettings()

    const useClaude = screen.getByTestId('btn-use-agent-claude')
    const useCodex = screen.getByTestId('btn-use-agent-codex')

    for (const btn of [useClaude, useCodex]) {
      expect(btn).toHaveAttribute('data-ui', 'button')
      expect(btn).toHaveAttribute('data-variant', 'secondary')
      expect(btn).toHaveAttribute('data-size', 'sm')
    }

    const primaries = container.querySelectorAll('[data-variant="primary"]')
    expect(primaries.length).toBeLessThanOrEqual(1)
  })

  test('New custom agent is a secondary md Button, left-aligned, not full width', () => {
    const { container } = renderAgentsSettings()

    const newCustom = screen.getByTestId('btn-new-custom-agent')
    expect(newCustom).toHaveAttribute('data-ui', 'button')
    expect(newCustom).toHaveAttribute('data-variant', 'secondary')
    expect(newCustom).toHaveAttribute('data-size', 'md')

    const rule = componentsCss.match(/\.settings-new-agent-btn\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(rule).toContain('align-self: flex-start')
    expect(rule).not.toMatch(/width\s*:\s*100%/)

    const primaries = container.querySelectorAll('[data-variant="primary"]')
    expect(primaries.length).toBeLessThanOrEqual(1)
  })
})
