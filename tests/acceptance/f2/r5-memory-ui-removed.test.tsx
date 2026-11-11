// Frozen acceptance test for the 1.5.0 cockpit removal R5, renderer side (OXE program, phase F2, task FE-R5). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R5).
// Contract: src/components/Workspace/ProjectInstructionsRow.tsx exports ProjectInstructionsRow({ workspaceId, rootPath }).
// It reads CLAUDE.md and AGENTS.md at the root with window.oxe.fs.readFile (a rejection means missing) and opens one
// in the preferred external editor through src/lib/openIn (window.oxe.app.openIn). Each existing file is a list item
// (li) with its name and an "Open in editor" button. Copy by DESIGN (08/11).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

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

const GONE = ['src/components/Workspace/WorkspaceMemorySettings.tsx', 'src/components/Workspace/WorkspaceMemoryNotes.tsx', 'src/hooks/useSharedProjectMemory.ts']

function mockMain(existing: string[]): { readFile: ReturnType<typeof vi.fn>; openIn: ReturnType<typeof vi.fn>; writeFile: ReturnType<typeof vi.fn> } {
  const readFile = vi.fn(async (input: { relativePath: string }) => {
    if (existing.includes(input.relativePath)) return { content: '# instructions', relativePath: input.relativePath }
    throw new Error('ENOENT')
  })
  const openIn = vi.fn(async () => undefined)
  const writeFile = vi.fn(async () => undefined)
  Object.assign(window, { oxe: {
    fs: { readFile, writeFile },
    app: { platform: 'win32', openIn, openInTargets: async () => ({ editors: [{ id: 'vscode', name: 'VS Code' }], preferred: 'vscode' }) }
  } })
  return { readFile, openIn, writeFile }
}

async function renderRow(): Promise<void> {
  const { ProjectInstructionsRow } = await load<{ ProjectInstructionsRow: (props: { workspaceId: string; rootPath: string }) => JSX.Element }>('src/components/Workspace/ProjectInstructionsRow')
  render(<ProjectInstructionsRow workspaceId="ws-1" rootPath="C:/repo" />)
  await screen.findByText(/Project instructions/)
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('R5 · AI Memory leaves the renderer; Project instructions takes its place', () => {
  test('the memory UI files are gone and no renderer source calls window.oxe.memory', () => {
    expect(GONE.filter(path => existsSync(join(ROOT, path)))).toEqual([])
    const pattern = /window\.oxe\??\.memory\b|WorkspaceMemorySettings|WorkspaceMemoryNotes|useSharedProjectMemory/
    expect(sources('src').filter(file => pattern.test(read(file)))).toEqual([])
  })

  test('workspace settings lists no Memory page', async () => {
    const { SETTINGS_PAGES } = await import('../../../src/components/Workspace/workspaceSettingsPages')
    expect(SETTINGS_PAGES.map(page => page.id as string)).not.toContain('memory')
    expect(read('src/components/Settings/SettingsCenter.tsx')).not.toMatch(/'memory'/)
  })

  test('Project instructions offers Open in editor for each of CLAUDE.md and AGENTS.md that exists', async () => {
    const main = mockMain(['CLAUDE.md', 'AGENTS.md'])
    await renderRow()
    expect(await screen.findByText('Agents read these at the start of each conversation.')).toBeInTheDocument()
    await screen.findByText('CLAUDE.md')
    const claude = screen.getAllByRole('listitem').find(item => item.textContent?.includes('CLAUDE.md')) as HTMLElement
    expect(claude).toBeTruthy()
    expect(screen.getByText('AGENTS.md')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Open in editor/ })).toHaveLength(2)
    await userEvent.click(within(claude).getByRole('button', { name: /Open in editor/ }))
    await waitFor(() => expect(main.openIn).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1', rootPath: 'C:/repo', path: 'CLAUDE.md' })))
    expect(main.readFile).toHaveBeenCalledWith(expect.objectContaining({ relativePath: 'CLAUDE.md' }))
    expect(main.readFile).toHaveBeenCalledWith(expect.objectContaining({ relativePath: 'AGENTS.md' }))
  })

  test('Project instructions says neither file exists and points to /init, and creates nothing', async () => {
    const main = mockMain([])
    await renderRow()
    await waitFor(() => expect(document.body.textContent).toMatch(/No CLAUDE\.md or AGENTS\.md at the root of this workspace\. Run \/init in a conversation to create one\./))
    expect(screen.queryByRole('button', { name: /Open in editor|Create/ })).toBeNull()
    expect(main.writeFile).not.toHaveBeenCalled()
  })
})
