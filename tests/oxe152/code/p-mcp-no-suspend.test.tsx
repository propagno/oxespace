// Frozen acceptance test for 1.5.2 OxeCode A4 (OXE program oxespace-152-code, phase F2, Jira OXE-39).
// Written by the planner; the executor must not edit it.
// Cause (diagnosis: scratchpad diag-oxecode-perf.md): App.tsx mounts McpPanel through a plain React.lazy only while the
// dialog is open, and nothing preloads it, so the first open shows nothing for ~340 ms. Contract:
// src/components/MCP/McpHost.tsx exports `MCP_PANEL_CHUNK` (src/lib/chunk.ts `chunk` over './McpPanel') and
// `McpPanelHost` (`lazyFrom(MCP_PANEL_CHUNK, m => m.McpPanel)`, same props as McpPanel). App.tsx renders McpPanelHost
// instead of a plain lazy; the chunk is preloaded after first paint and on hover/focus of the MCP button. Once the
// chunk has arrived, the "MCP servers" dialog renders in the same commit, even while the server list is still loading.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Host = {
  MCP_PANEL_CHUNK: { load: () => Promise<unknown>; get: () => unknown }
  McpPanelHost: (props: { workspaceId: string | null; onClose: () => void }) => JSX.Element
}

beforeEach(async () => {
  await changeLanguage('en')
  const never = () => new Promise<never>(() => undefined)
  const oxe = (window as unknown as { oxe?: Record<string, unknown> }).oxe ?? {}
  Object.assign(window, { oxe: { ...oxe,
    mcp: new Proxy({}, { get: (_target, key) => key === 'onChanged' || String(key).startsWith('on') ? () => () => undefined : never }),
    mcpInternal: new Proxy({}, { get: (_target, key) => String(key).startsWith('on') ? () => () => undefined : never })
  } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('A4 · the MCP servers dialog opens in the same commit once its chunk has arrived (OXE-39)', () => {
  test('after the chunk loads, McpPanelHost renders the "MCP servers" dialog at once, while the list is still loading', async () => {
    const { MCP_PANEL_CHUNK, McpPanelHost } = await import('../../../src/components/MCP/McpHost') as unknown as Host
    await MCP_PANEL_CHUNK.load()
    expect(MCP_PANEL_CHUNK.get()).toBeDefined()
    act(() => { render(<McpPanelHost workspaceId={null} onClose={() => undefined} />) })
    expect(screen.queryByRole('dialog', { name: 'MCP servers' })).not.toBeNull()
  }, 30_000)

  test('App.tsx no longer mounts McpPanel through a plain lazy import', () => {
    // rigor: source-assertion — App mounts the whole shell; the behaviour is proven above on McpPanelHost, and this pins
    // that App uses it.
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).not.toMatch(/lazy\(\s*\(\)\s*=>\s*import\(['"]\.\/components\/MCP\/McpPanel['"]\)/)
    expect(app).toMatch(/McpPanelHost/)
  })
})
