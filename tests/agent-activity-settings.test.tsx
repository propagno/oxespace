import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentActivitySettings } from '../src/components/Settings/AgentActivitySettings'
import type { AgentActionEntry } from '../shared/types/mcp-internal'

afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe })

function mount(entries: AgentActionEntry[] | null, exportAudit: () => Promise<string | null> = async () => null) {
  ;(window as unknown as { oxe: unknown }).oxe = { mcpInternal: { actionAudit: async () => entries, exportAudit } }
  render(<AgentActivitySettings />)
}

describe('AgentActivitySettings', () => {
  it('lists agent changes with what the person decided', async () => {
    mount([
      { id: 2, ts: 0, actor: 'thread:t1', tool: 'oxespace_git_change', action: 'push', level: 'confirm', text: 'git push\nmain → origin/main', decision: 'approved', outcome: 'ok' },
      { id: 1, ts: 0, actor: 'pane:p1', tool: 'oxespace_github_change', action: 'create_release', level: 'confirm', decision: 'denied', outcome: 'skipped' }
    ])
    const rows = await screen.findAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('git_change.push')
    expect(rows[0]).toHaveTextContent('you approved — git push main → origin/main')
    expect(rows[0].className).toContain('tone-ok')
    expect(rows[1]).toHaveTextContent('you declined')
    expect(rows[1].className).toContain('tone-warning')
  })

  it('says when there is nothing yet, also when the bridge answers nothing', async () => {
    mount(null)
    expect(await screen.findByText('No agent changes yet.')).toBeVisible()
  })

  it('exports the audit and says where it was saved', async () => {
    mount([], async () => 'C:/exports/oxespace-audit.jsonl')
    fireEvent.click(await screen.findByRole('button', { name: /Export the audit/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved the audit to C:/exports/oxespace-audit.jsonl')
  })
})
