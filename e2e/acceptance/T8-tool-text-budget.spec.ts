import { expect, test } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * T8 (S5) · The tool text a session carries stays within budget, as a generic MCP client sees it.
 * Roadmap acceptance: an ordinary conversation ≤ 9,000 characters of tool text; every on-demand group on costs a
 * bounded fixed amount; the test fails if any limit goes up.
 *
 * REAL internal MCP server, no agent runs: tools/list over POST /rpc with the workspace token, before and after
 * turning groups on with oxespace_tools_enable. Today (homologation check-182) a fresh session lists 94 tools /
 * 60,582 characters, so this is red until S5 lands.
 */
const ORDINARY_BUDGET = 9_000
/** ~1.5k tokens of fixed cost per on-demand group, at ~4 characters per token. */
const ON_DEMAND_INDEX_BUDGET = 6_000

test('T8: an ordinary session lists at most 9,000 characters of tools', async () => {
  test.setTimeout(150_000)
  const profile = realProfile('t8', { OXESPACE_LOCALE: 'en-US' })
  const { app, page } = await launchReal(profile)
  try {
    await openRepo(page, profile.repo)
    const db = new DatabaseSync(profile.db)
    const meta = db.prepare('SELECT port, token FROM internal_mcp_meta LIMIT 1').get() as { port: number; token: string }
    const workspace = (db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
    db.close()
    const rpc = async (method: string, params: object = {}) => {
      const res = await fetch(`http://127.0.0.1:${meta.port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${meta.token}`, 'X-OXE-Workspace-Id': workspace }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      return res.json() as Promise<{ result?: { tools?: Array<{ name: string }>; isError?: boolean } }>
    }
    const size = async () => { const tools = (await rpc('tools/list')).result?.tools ?? []; return { count: tools.length, chars: JSON.stringify(tools).length, names: tools.map(t => t.name) } }

    const ordinary = await size()
    test.info().annotations.push({ type: 'ordinary', description: `${ordinary.count} tools, ${ordinary.chars} chars` })
    expect(ordinary.chars, `ordinary session tool text (${ordinary.count} tools)`).toBeLessThanOrEqual(ORDINARY_BUDGET)
    // What lets an agent find the rest is always there.
    expect(ordinary.names).toEqual(expect.arrayContaining(['oxespace_capabilities', 'oxespace_tools_enable']))
    // Turning one group on adds that group only, and its cost is bounded.
    await rpc('tools/call', { name: 'oxespace_tools_enable', arguments: { group: 'search' } })
    const withSearch = await size()
    expect(withSearch.chars - ordinary.chars, 'one on-demand group costs a bounded amount').toBeLessThanOrEqual(ON_DEMAND_INDEX_BUDGET)
    expect(withSearch.names.filter(n => !ordinary.names.includes(n)).length, 'the group adds tools').toBeGreaterThan(0)
  } finally { await quitReal(app) }
})
