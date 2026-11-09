// Frozen acceptance test for the 1.5.0 cockpit removal R7, renderer side (OXE program, phase F2, task FE-R7). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R7).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
function sources(dir: string): string[] {
  const out: string[] = []
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(ROOT, rel))) {
      const path = `${rel}/${name}`
      if (statSync(join(ROOT, path)).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(name)) out.push(path)
    }
  }
  walk(dir)
  return out
}

const GONE = ['src/components/Teams', 'src/app/projectTeam.ts']

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('R7 · Teams leave the renderer; Delegated work stays', () => {
  test('the Teams UI files are gone and no renderer source imports TeamDialog', () => {
    expect(GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])
    const pattern = /TeamDialog|projectTeam|components\/Teams\/|teamScope|window\.oxe\??\.team\b/
    expect(sources('src').filter(file => pattern.test(read(file)))).toEqual([])
  })

  test('the tool catalog, the palette and the keybindings have no team entry', async () => {
    const { TOOL_CATALOG } = await import('../../../src/components/Workspace/toolCatalog')
    expect(TOOL_CATALOG.map(tool => tool.id as string)).not.toContain('team')
    const { KEYBINDINGS } = await import('../../../src/keyboard/keybindings')
    expect(KEYBINDINGS.map(binding => binding.id as string).filter(id => id.startsWith('team.'))).toEqual([])
    expect(read('src/commands/code.commands.ts')).not.toMatch(/hasTeamTarget|teamUnavailable|'team'/)
  })

  test('Delegated work still renders its task list', async () => {
    const task = { id: 'task-1', workspaceId: 'ws-1', objective: 'Split the parser into modules', branch: 'oxe/split-parser', state: 'accepted', agentProfileId: 'claude', surface: 'terminal', updatedAt: Date.UTC(2026, 9, 14), path: '/wt', baseSha: 'abc', cwd: '/repo', dependencies: [] }
    Object.assign(window, { oxe: { delegation: {
      status: vi.fn(async () => ({ enabled: true, tasks: [task] })),
      onChanged: vi.fn(() => () => undefined),
      control: vi.fn(async () => undefined),
      adopt: vi.fn(async () => undefined)
    } } })
    const { DelegatedWorkDialog } = await import('../../../src/components/Delegation/DelegatedWorkDialog')
    render(<DelegatedWorkDialog workspaces={[{ id: 'ws-1', name: 'repo' } as never]} workspaceId="ws-1" onClose={() => undefined} onOpen={async () => true} />)
    expect(await screen.findByText('Split the parser into modules')).toBeInTheDocument()
  })
})
