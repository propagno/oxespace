import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ContextUsageStatus } from '../src/components/Terminal/ContextUsageStatus'
import { contextUsageKey, useContextUsageStore } from '../src/store/contextUsage.store'

afterEach(() => useContextUsageStore.setState({ byKey: {}, loading: {} }))

describe('Code pane context chip', () => {
  it('shows how much of the context window is left, with the used tokens in the tooltip label', () => {
    const key = contextUsageKey({ provider: 'claude', workspaceRootPath: '/repo' })
    useContextUsageStore.setState({
      byKey: { [key]: { provider: 'claude', available: true, usedPct: 72, usedTokens: 144_000, limitTokens: 200_000, modelId: 'claude-test' } as never },
      refresh: async () => undefined
    })
    render(<ContextUsageStatus provider="claude" rootPath="/repo" />)
    expect(screen.getByText('28% context left')).toBeInTheDocument()
    expect(screen.getByLabelText('Context window: 28% left').className).toContain('tone-warning')
  })
})
