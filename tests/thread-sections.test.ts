import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeThreadSections } from '../shared/thread-sections'
import type { ConversationThread } from '../shared/types/thread'
import type { ThreadSections } from '../shared/types/thread-sections'
import { LEGACY_STORAGE_PREFIX, projectAssignments, resetSectionsForTests, sectionsApi } from '../src/components/Threads/sections/sectionsApi'
import { normalizeSectionName, sameSectionName, SECTION_NAME_MAX, sectionErrorCode, SectionError, type ThreadSection } from '../src/components/Threads/sections/sectionsContract'
import { groupBySection, moveSectionIds } from '../src/components/Threads/sections/sectionsModel'
import { useThreadStore } from '../src/store/thread.store'

const thread = (id: string, projectId: string, extra: Record<string, unknown> = {}): ConversationThread =>
  ({ id, workspaceId: `thread:${projectId}`, projectId, rootPath: '/repo', provider: 'claude', title: id, pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1, ...extra }) as ConversationThread

/** The main process's two channels, kept in memory and checked by the same shared validator as main. */
function setup() {
  const threads = [thread('a', 'p1'), thread('b', 'p1'), thread('child', 'p1', { parentThreadId: 'a' }), thread('other', 'p2')]
  useThreadStore.setState({ threads })
  const main = new Map<string, ThreadSections>()
  const bridge = {
    sections: vi.fn(async (workspaceId: string) => structuredClone(main.get(workspaceId) ?? { sections: [], assignments: {} })),
    saveSections: vi.fn(async (workspaceId: string, state: ThreadSections) => {
      const result = normalizeThreadSections(state, id => threads.some(item => item.id === id && item.workspaceId === workspaceId))
      if (result.ok) main.set(workspaceId, structuredClone(result.state))
      return result
    })
  }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: bridge } })
  return { api: sectionsApi(), main, bridge }
}

beforeEach(() => { localStorage.clear(); resetSectionsForTests() })
afterEach(() => { delete (window as unknown as { oxe?: unknown }).oxe })

const rejection = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => sectionErrorCode(error))

describe('section names', () => {
  it('trims and accepts up to the limit, without control characters', () => {
    expect(normalizeSectionName('  Work  ')).toBe('Work')
    expect(normalizeSectionName('x'.repeat(SECTION_NAME_MAX))).toHaveLength(SECTION_NAME_MAX)
    expect(normalizeSectionName('x'.repeat(SECTION_NAME_MAX + 1))).toBeNull()
    expect(normalizeSectionName('   ')).toBeNull()
    expect(normalizeSectionName('two\nlines')).toBeNull()
    expect(normalizeSectionName('tab\there')).toBeNull()
    expect(normalizeSectionName('Seção ✓ 🚀')).toBe('Seção ✓ 🚀')
  })
  it('refuses bidirectional and format controls that make a name read in another order than it is stored', () => {
    for (const control of ['‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩', '‎', '‏']) {
      expect(normalizeSectionName(`Work${control}cod.exe`), control.codePointAt(0)!.toString(16)).toBeNull()
    }
    // Right-to-left text itself is fine; only the invisible controls are refused.
    expect(normalizeSectionName('عمل')).toBe('عمل')
  })
  it('compares names without case, trimmed, in one Unicode form', () => {
    expect(sameSectionName('Work', ' work ')).toBe(true)
    expect(sameSectionName('Seção', 'SEÇÃO')).toBe(true)
    expect(sameSectionName('Séção'.normalize('NFD'), 'Seção'.normalize('NFC'))).toBe(false)
    expect(sameSectionName('Café'.normalize('NFD'), 'café')).toBe(true)
    expect(sameSectionName('Work', 'Works')).toBe(false)
  })
  it('reads the code from a thrown error, an IPC object and an IPC message', () => {
    expect(sectionErrorCode(new SectionError('thread.section.notFound'))).toBe('thread.section.notFound')
    expect(sectionErrorCode({ code: 'thread.section.invalidName', params: { max: 60 } })).toBe('thread.section.invalidName')
    expect(sectionErrorCode(new Error("Error invoking remote method 'thread:section-move': thread.section.childFollowsParent"))).toBe('thread.section.childFollowsParent')
    expect(sectionErrorCode(new Error('EBUSY'))).toBeNull()
  })
})

describe('sections over the main process', () => {
  it('creates, renames and lists per project, saved as the workspace state main keeps', async () => {
    const { api, main } = setup()
    const work = await api.createSection({ projectId: 'p1', name: ' Work ' })
    await api.createSection({ projectId: 'p1', name: 'Ideas' })
    await api.createSection({ projectId: 'p2', name: 'Elsewhere' })
    expect(work).toMatchObject({ projectId: 'p1', name: 'Work', order: 0, collapsed: false })
    await api.renameSection({ id: work.id, name: 'Shipping' })
    expect((await api.listSections('p1')).map(section => [section.name, section.order])).toEqual([['Shipping', 0], ['Ideas', 1]])
    expect((await api.listSections('p2')).map(section => section.name)).toEqual(['Elsewhere'])
    expect(main.get('thread:p1')!.sections.map(section => section.name)).toEqual(['Shipping', 'Ideas'])
    expect(main.get('thread:p2')!.sections.map(section => section.name)).toEqual(['Elsewhere'])
  })

  it('rejects invalid names with thread.section.invalidName and its max', async () => {
    const { api, bridge } = setup()
    await expect(api.createSection({ projectId: 'p1', name: '' })).rejects.toMatchObject({ code: 'thread.section.invalidName', params: { max: SECTION_NAME_MAX } })
    await expect(api.createSection({ projectId: 'p1', name: 'x'.repeat(61) })).rejects.toMatchObject({ code: 'thread.section.invalidName' })
    const section = await api.createSection({ projectId: 'p1', name: 'Ok' })
    expect(await rejection(api.renameSection({ id: section.id, name: 'bad\u0007' }))).toBe('thread.section.invalidName')
    expect(await rejection(api.renameSection({ id: 'missing', name: 'Fine' }))).toBe('thread.section.notFound')
    // Nothing invalid reached main: the window checks with the same rules first.
    expect(bridge.saveSections).toHaveBeenCalledTimes(1)
  })

  it('words a refusal from main the same way, and a refused save changes nothing here', async () => {
    const { api, bridge } = setup()
    await api.createSection({ projectId: 'p1', name: 'Work' })
    bridge.saveSections.mockResolvedValueOnce({ ok: false, refusal: 'nameDuplicate', message: { code: 'thread.sections.nameDuplicate', params: {} } } as never)
    expect(await rejection(api.createSection({ projectId: 'p1', name: 'Ideas' }))).toBe('thread.section.duplicateName')
    bridge.saveSections.mockResolvedValueOnce({ ok: false, refusal: 'tooMany', message: { code: 'thread.sections.tooMany', params: {} } } as never)
    await expect(api.createSection({ projectId: 'p1', name: 'More' })).rejects.toMatchObject({ code: 'thread.sections.tooMany' })
    expect((await api.listSections('p1')).map(section => section.name)).toEqual(['Work'])
  })

  it('refuses a second section with the same name in a project, whatever its case; renaming a section to itself is fine', async () => {
    const { api } = setup()
    const work = await api.createSection({ projectId: 'p1', name: 'Work' })
    await api.createSection({ projectId: 'p1', name: 'Ideas' })
    expect(await rejection(api.createSection({ projectId: 'p1', name: ' WORK ' }))).toBe('thread.section.duplicateName')
    expect(await rejection(api.renameSection({ id: work.id, name: 'ideas' }))).toBe('thread.section.duplicateName')
    await expect(api.renameSection({ id: work.id, name: 'work' })).resolves.toMatchObject({ name: 'work' })
    // Another project may use the same name.
    await expect(api.createSection({ projectId: 'p2', name: 'Work' })).resolves.toMatchObject({ name: 'Work' })
  })

  it('moves conversations, and deleting a section keeps them with no section', async () => {
    const { api, main } = setup()
    const work = await api.createSection({ projectId: 'p1', name: 'Work' })
    await api.moveToSection({ threadId: 'a', sectionId: work.id })
    await api.moveToSection({ threadId: 'b', sectionId: work.id })
    expect(projectAssignments('p1')).toEqual({ a: work.id, b: work.id })
    await api.moveToSection({ threadId: 'b', sectionId: null })
    expect(projectAssignments('p1')).toEqual({ a: work.id })
    await api.deleteSection({ id: work.id })
    expect(projectAssignments('p1')).toEqual({})
    expect(await api.listSections('p1')).toEqual([])
    expect(main.get('thread:p1')).toEqual({ sections: [], assignments: {} })
  })

  it('never moves a child: it follows its parent', async () => {
    const { api } = setup()
    const work = await api.createSection({ projectId: 'p1', name: 'Work' })
    expect(await rejection(api.moveToSection({ threadId: 'child', sectionId: work.id }))).toBe('thread.section.childFollowsParent')
    expect(await rejection(api.moveToSection({ threadId: 'unknown', sectionId: work.id }))).toBe('thread.section.notFound')
    // A section of another project is not found from this conversation.
    const elsewhere = await api.createSection({ projectId: 'p2', name: 'Elsewhere' })
    expect(await rejection(api.moveToSection({ threadId: 'a', sectionId: elsewhere.id }))).toBe('thread.section.notFound')
  })

  it('reorders only with exactly the project set, and collapses', async () => {
    const { api } = setup()
    const one = await api.createSection({ projectId: 'p1', name: 'One' })
    const two = await api.createSection({ projectId: 'p1', name: 'Two' })
    const three = await api.createSection({ projectId: 'p1', name: 'Three' })
    expect((await api.reorderSections({ projectId: 'p1', ids: [three.id, one.id, two.id] })).map(section => section.name)).toEqual(['Three', 'One', 'Two'])
    expect(await rejection(api.reorderSections({ projectId: 'p1', ids: [one.id, two.id] }))).toBe('thread.section.notFound')
    expect(await rejection(api.reorderSections({ projectId: 'p1', ids: [one.id, one.id, two.id] }))).toBe('thread.section.notFound')
    await api.setSectionCollapsed({ id: two.id, collapsed: true })
    expect((await api.listSections('p1')).find(section => section.id === two.id)?.collapsed).toBe(true)
    await api.deleteSection({ id: three.id })
    expect((await api.listSections('p1')).map(section => [section.name, section.order])).toEqual([['One', 0], ['Two', 1]])
  })

  it('changes made together are saved one after the other, none lost', async () => {
    const { api, main } = setup()
    await Promise.all(['One', 'Two', 'Three'].map(name => api.createSection({ projectId: 'p1', name })))
    expect(main.get('thread:p1')!.sections.map(section => section.name).sort()).toEqual(['One', 'Three', 'Two'])
  })

  it('announces every change for its project', async () => {
    const { api } = setup()
    const listener = vi.fn()
    const off = api.onSectionsChanged(listener)
    const section = await api.createSection({ projectId: 'p1', name: 'Work' })
    await api.moveToSection({ threadId: 'a', sectionId: section.id })
    off()
    await api.deleteSection({ id: section.id })
    expect(listener.mock.calls).toEqual([[{ projectId: 'p1' }], [{ projectId: 'p1' }]])
  })
})

describe('sections kept in this window before main kept them', () => {
  const legacy = { sections: [{ id: 'work', projectId: 'p1', name: 'Work', order: 0, collapsed: true, createdAt: 1 }, { id: 'dupe', projectId: 'p1', name: 'WORK', order: 1, collapsed: false, createdAt: 2 }], assignments: { a: 'work', gone: 'work', b: 'missing' } }

  it('move to main once, on the first load, and the local copy is forgotten', async () => {
    localStorage.setItem(`${LEGACY_STORAGE_PREFIX}p1`, JSON.stringify(legacy))
    const { api, main, bridge } = setup()
    expect((await api.listSections('p1')).map(section => [section.name, section.collapsed])).toEqual([['Work', true]])
    // Main keeps assignments of its own conversations only; a duplicate name is not carried over.
    expect(main.get('thread:p1')).toEqual({ sections: [{ id: 'work', name: 'Work', order: 0, collapsed: true }], assignments: { a: 'work' } })
    expect(localStorage.getItem(`${LEGACY_STORAGE_PREFIX}p1`)).toBeNull()
    resetSectionsForTests()
    await sectionsApi().listSections('p1')
    expect(bridge.saveSections).toHaveBeenCalledTimes(1)
  })

  it('what main already keeps wins; the local copy is not merged in', async () => {
    localStorage.setItem(`${LEGACY_STORAGE_PREFIX}p1`, JSON.stringify(legacy))
    const { api, main, bridge } = setup()
    main.set('thread:p1', { sections: [{ id: 'main', name: 'From main', order: 0, collapsed: false }], assignments: {} })
    expect((await api.listSections('p1')).map(section => section.name)).toEqual(['From main'])
    expect(bridge.saveSections).not.toHaveBeenCalled()
    expect(localStorage.getItem(`${LEGACY_STORAGE_PREFIX}p1`)).toBeNull()
  })

  it('a refused move keeps the local copy for the next start; damaged storage is ignored', async () => {
    localStorage.setItem(`${LEGACY_STORAGE_PREFIX}p1`, JSON.stringify(legacy))
    localStorage.setItem(`${LEGACY_STORAGE_PREFIX}p2`, '{not json')
    const { api, bridge } = setup()
    bridge.saveSections.mockResolvedValueOnce({ ok: false, refusal: 'unknownWorkspace', message: { code: 'thread.sections.unknownWorkspace', params: {} } } as never)
    expect(await api.listSections('p1')).toEqual([])
    expect(localStorage.getItem(`${LEGACY_STORAGE_PREFIX}p1`)).not.toBeNull()
    expect(await api.listSections('p2')).toEqual([])
  })
})

describe('grouping the list', () => {
  const section = (id: string, order: number): ThreadSection => ({ id, projectId: 'p1', name: id, order, collapsed: false })
  it('puts conversations in section order, keeps their order, and sends unknown sections to no section', () => {
    const where: Record<string, string | null> = { a: 'later', b: null, c: 'first', d: 'gone', e: 'first' }
    const result = groupBySection(['a', 'b', 'c', 'd', 'e'], [section('later', 1), section('first', 0), section('empty', 2)], id => where[id])
    expect(result.sections.map(group => [group.section.id, group.threads])).toEqual([['first', ['c', 'e']], ['later', ['a']], ['empty', []]])
    expect(result.loose).toEqual(['b', 'd'])
  })
  it('moves a section one place and refuses to move past the ends', () => {
    const sections = [section('a', 0), section('b', 1), section('c', 2)]
    expect(moveSectionIds(sections, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveSectionIds(sections, 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveSectionIds(sections, 'a', -1)).toBeNull()
    expect(moveSectionIds(sections, 'c', 1)).toBeNull()
    expect(moveSectionIds(sections, 'x', 1)).toBeNull()
  })
})
