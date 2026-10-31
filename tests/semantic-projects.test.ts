import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SemanticProjects } from '../electron/main/services/semantic-projects'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fakeIndex() {
  const enabled = new Map<string, boolean>()
  return {
    enabled,
    setEnabled: vi.fn((id: string, on: boolean) => { enabled.set(id, on) }),
    isEnabled: (id: string) => enabled.get(id) ?? false,
    getStatus: (id: string) => ({ enabled: enabled.get(id) ?? false, indexing: false, count: 0 }) as never
  }
}

describe('semantic search for Thread projects', () => {
  it('stays off until turned on, saves the choice and starts the index after a restart only when searched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxe-semantic-projects-')); dirs.push(dir)
    const file = join(dir, 'semantic-projects.json')
    const index = fakeIndex()
    const projects = new SemanticProjects(index, file)
    expect(projects.ensure('C:/repo')).toBeNull()
    expect(index.setEnabled).not.toHaveBeenCalled()

    projects.set('C:/repo', true)
    expect(index.setEnabled).toHaveBeenLastCalledWith(SemanticProjects.idFor('C:/repo'), true, 'C:/repo')
    expect(JSON.parse(readFileSync(file, 'utf8')).roots).toHaveLength(1)

    // After a restart nothing is indexed until an agent of the project searches.
    const restarted = fakeIndex()
    const again = new SemanticProjects(restarted, file)
    expect(restarted.setEnabled).not.toHaveBeenCalled()
    expect(again.isOn('C:/repo/')).toBe(true)
    expect(again.ensure('C:/repo')).toBe(SemanticProjects.idFor('C:/repo'))
    expect(restarted.setEnabled).toHaveBeenCalledOnce()
    again.ensure('C:/repo')
    expect(restarted.setEnabled).toHaveBeenCalledOnce()

    again.set('C:/repo', false)
    expect(again.isOn('C:/repo')).toBe(false)
    expect(again.ensure('C:/repo')).toBeNull()
    expect(restarted.enabled.get(SemanticProjects.idFor('C:/repo'))).toBe(false)
  })

  it('names the index by the normalized directory, apart from Code workspace ids', () => {
    expect(SemanticProjects.idFor('/home/me/repo/')).toBe(SemanticProjects.idFor('/home/me/repo'))
    expect(SemanticProjects.idFor('/home/me/repo')).toMatch(/^project:/)
  })
})
