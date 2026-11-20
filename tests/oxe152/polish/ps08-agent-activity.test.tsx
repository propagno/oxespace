import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AgentActivitySettings } from '../../../src/components/Settings/AgentActivitySettings'
import displayStyles from '../../../src/ui/Display.module.css'

const displayCss = readFileSync(join(process.cwd(), 'src/ui/Display.module.css'), 'utf8')
const settingsCenterCss = readFileSync(join(process.cwd(), 'src/components/Settings/SettingsCenter.css'), 'utf8')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function mockActivity(rows: Array<Record<string, unknown>>) {
  const list = vi.fn(async () => ({ rows, cursor: null, failedSources: [] }))
  const hostsProxy = {
    state: vi.fn(async () => ({ enabled: false, state: 'stopped', hosts: [] })),
    setEnabled: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    onChanged: vi.fn(() => () => undefined)
  }
  Object.assign(window, {
    oxe: {
      ...(window as unknown as { oxe?: object }).oxe,
      agentActivity: { list, detail: vi.fn(async () => null) },
      hostsProxy
    }
  })
  return { list }
}

describe('OXE-238 · PS-08·11 Agent activity filters in SegmentedControl and waiting badge in amber', () => {
  test('the agent activity filters are a src/ui SegmentedControl', async () => {
    const user = userEvent.setup()
    const { list } = mockActivity([
      { id: 'r1', source: 'databases', at: Date.now(), actor: { name: 'Pix' }, summary: 'SELECT 1', decision: 'approved', outcome: 'ok' }
    ])

    const { container } = render(<AgentActivitySettings />)
    const group = await screen.findByRole('radiogroup')
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(5)
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')

    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(0)

    const beforeCalls = list.mock.calls.length
    await user.click(within(group).getByRole('radio', { name: /^Databases/ }))
    await waitFor(() => expect(list.mock.calls.length).toBe(beforeCalls + 1))
    expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ sources: ['databases'] })
    expect(within(group).getByRole('radio', { name: /^Databases/ })).toHaveAttribute('aria-checked', 'true')
    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(0)
  })

  test('[css] a waiting-for-you item is an attention Badge in --attn-bg, --attn-border and --attn-fg', async () => {
    mockActivity([
      { id: 'r-wait', source: 'databases', at: Date.now(), actor: { name: 'Billing' }, summary: 'DROP TABLE tmp', decision: 'pending', outcome: null }
    ])

    render(<AgentActivitySettings />)
    const badge = await screen.findByText('Waiting for you')
    expect(badge.classList.contains(displayStyles.badge)).toBe(true)
    expect(badge.classList.contains(displayStyles.attention)).toBe(true)

    const attentionRule = displayCss.match(/\.badge\.attention\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(attentionRule).toContain('var(--attn-bg)')
    expect(attentionRule).toContain('var(--attn-border)')
    expect(attentionRule).toContain('var(--attn-fg)')

    const attnChipRule = settingsCenterCss.match(/\.chip\.tone-attn\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(attnChipRule).not.toContain('--intent-warning')
  })
})
