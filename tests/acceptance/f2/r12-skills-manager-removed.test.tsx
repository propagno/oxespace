// Frozen acceptance test for the 1.5.0 cockpit removal R12, renderer side (OXE program, phase F2, task FE-R12). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R12).
// Contract: src/components/Settings/SkillsList.tsx exports SkillsList (no props), a read-only list from useSkillStore
// (name in mono, description, scope), shown in Settings › Tools under "MCP servers and skills" (DESIGN, #673).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SkillDefinition } from '../../../shared/types/skill'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
// Modules this task creates load at run time, so a missing one fails its own checks, not the whole file.
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(ROOT, `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
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

const SKILLS: SkillDefinition[] = [
  { name: 'review-pr', description: 'Review the open pull request', agents: [], filePath: '/home/me/.oxe/skills/review-pr.md', body: 'Review it.', source: 'user', mtimeMs: 1 },
  { name: 'release-notes', description: 'Draft the release notes', agents: [], filePath: '/repo/.oxe/skills/release-notes.md', body: 'Draft.', source: 'workspace', mtimeMs: 1 }
]

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('R12 · the skills manager leaves; skills stay as a read-only list and in the command bar', () => {
  test('the skills manager is gone and no renderer source creates a skill', async () => {
    expect(existsSync(join(ROOT, 'src/components/Skills/SkillsBrowser.tsx'))).toBe(false)
    const pattern = /SkillsBrowser|isSkillsBrowserOpen|openSkillsBrowser|createSkill|CreateSkillInput|window\.oxe\??\.skills?\??\.create\b/
    expect(sources('src').filter(file => pattern.test(read(file)))).toEqual([])
    const { useSkillStore } = await import('../../../src/store/skill.store')
    const state = useSkillStore.getState() as unknown as Record<string, unknown>
    expect(['skills', 'refresh', 'invoke', 'subscribe'].filter(name => typeof state[name] === 'undefined')).toEqual([])
  })

  test('the tool catalog has no Skills tool', async () => {
    const { TOOL_CATALOG } = await import('../../../src/components/Workspace/toolCatalog')
    expect(TOOL_CATALOG.map(tool => tool.id as string)).not.toContain('skills')
  })

  test('the command bar lists the available skills with their descriptions', async () => {
    // jsdom has no scrollIntoView; the overlay keeps the selected row in view with it.
    Element.prototype.scrollIntoView = vi.fn()
    const { SlashOverlay } = await import('../../../src/components/SlashOverlay/SlashOverlay')
    render(<SlashOverlay paneId="pane-1" paneLabel="Pane 1.1" skills={SKILLS} onClose={() => undefined} onExecute={() => undefined} />)
    expect(await screen.findByText(/review-pr/)).toBeInTheDocument()
    expect(screen.getByText('Review the open pull request')).toBeInTheDocument()
    expect(screen.getByText('Draft the release notes')).toBeInTheDocument()
  })

  test('running a skill from the command bar invokes it for the pane', async () => {
    const { useSkillStore } = await import('../../../src/store/skill.store')
    const invoke = vi.fn(async () => undefined)
    useSkillStore.setState({ invoke })
    const { findSlashCommand } = await import('../../../src/lib/slashCommands')
    const command = findSlashCommand('review-pr', SKILLS)
    expect(command).not.toBeNull()
    const { runSlashCommand } = await import('../../../src/lib/slashDispatch')
    await runSlashCommand({ workspace: { id: 'ws-1' } as never, pane: { id: 'pane-1' } as never }, command as NonNullable<typeof command>, 'main')
    expect(invoke).toHaveBeenCalledWith('review-pr', 'pane-1', 'main')
  })

  test('Settings lists the skills read only, with name, description and scope', async () => {
    const { useSkillStore } = await import('../../../src/store/skill.store')
    useSkillStore.setState({ skills: SKILLS, loaded: true, loading: false, error: null, refresh: vi.fn(async () => undefined) })
    const { SkillsList } = await load<{ SkillsList: () => JSX.Element }>('src/components/Settings/SkillsList')
    render(<SkillsList />)
    expect(await screen.findByText('review-pr')).toBeInTheDocument()
    expect(screen.getByText('Review the open pull request')).toBeInTheDocument()
    expect(screen.getByText('release-notes')).toBeInTheDocument()
    expect(document.body.textContent).toMatch(/Workspace|Project/)
    expect(document.body.textContent).toMatch(/User|Global|Personal/)
    expect(screen.queryAllByRole('switch')).toEqual([])
    expect(screen.queryAllByRole('checkbox')).toEqual([])
    expect(screen.queryByRole('button', { name: /New|Create|Install|Edit|Delete/ })).toBeNull()
    expect(read('src/components/Settings/ToolsSettings.tsx')).toMatch(/SkillsList/)
  })
})
