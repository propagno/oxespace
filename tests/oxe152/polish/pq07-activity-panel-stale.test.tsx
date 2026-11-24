// OXE-320, beside the frozen pq07-activity-panel.test.tsx (which stays as written): the agent activity panel reads its
// first page inside the effect, and an answer that arrives after the effect was cleaned up (the tab left and came back,
// or a newer read started) is dropped instead of overwriting what the newer read showed.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ActivityPanel } from '../../../src/components/OxeQuery/ActivityPanel'
import { installFakeOxeQuery, type FakeOxeQuery } from '../../helpers/oxequery-api'

let catalog: unknown
/** The English OxeQuery catalog text of a key, so elements are found by the string the person reads. */
function cat(key: string): string {
  catalog ??= JSON.parse(readFileSync(join(process.cwd(), 'shared/locales/en/oxequery.json'), 'utf8'))
  let node: unknown = catalog
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the en oxequery catalog has no key ${key}`)
  return node
}

const entry = (id: number, text: string) => ({
  id, ts: 1_700_000_000_000 - id, actor: 'pane:p1', actorLabel: 'Claude · 2', connectionId: 'c1', connectionName: 'shop', engine: 'postgres', environment: 'dev',
  tool: 'oxespace_db_query', textHash: null, text, decision: 'auto', outcome: 'ok', rows: 1, durationMs: 2, errorCode: null
})
type Page = { entries: ReturnType<typeof entry>[]; hasMore: boolean; cursor: string | null }

let api: FakeOxeQuery
beforeEach(() => { api = installFakeOxeQuery() })
afterEach(() => cleanup())

describe('OXE-320 · Agent activity drops a stale load', () => {
  test('ActivityPanel ignores stale load responses when tab switches quickly', async () => {
    const pending: Array<(page: Page) => void> = []
    api.on('audit.list', () => new Promise<Page>(resolve => { pending.push(resolve) }))
    const view = render(<ActivityPanel active />)
    await waitFor(() => expect(pending).toHaveLength(1))
    view.rerender(<ActivityPanel active={false} />)
    view.rerender(<ActivityPanel active />)
    await waitFor(() => expect(pending).toHaveLength(2))

    pending[1]({ entries: [entry(20, 'SELECT newer')], hasMore: false, cursor: null })
    await screen.findByText('SELECT newer')
    pending[0]({ entries: [entry(10, 'SELECT older')], hasMore: true, cursor: 'stale' })
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(screen.queryByText('SELECT older')).toBeNull()
    expect(screen.getByText('SELECT newer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: cat('activity.loadMore') })).toBeNull()

    // Refresh still reads the first page again.
    fireEvent.click(screen.getByRole('button', { name: cat('common.refresh') }))
    await waitFor(() => expect(pending).toHaveLength(3))
    pending[2]({ entries: [entry(30, 'SELECT refreshed')], hasMore: false, cursor: null })
    await screen.findByText('SELECT refreshed')
  })
})
