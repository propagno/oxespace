import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadSectionsStore } from '../../electron/main/services/conversation/thread-sections'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

/** A Code workspace `code`, Thread projects `p1` and `p2`, and conversations in each. */
function setup() {
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('code', 'Code', '/repo', '1x1', 'builtin-claude')").run()
  for (const project of ['p1', 'p2']) db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES (?, ?, '/repo', ?, 1, 1)").run(project, project, project)
  const conversation = (id: string, workspaceId: string, projectId = 'p1') => db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json) VALUES (?, ?, ?, ?)')
    .run(id, workspaceId, projectId, JSON.stringify({ id, workspaceId, projectId }))
  conversation('t1', 'thread:p1'); conversation('t2', 'thread:p1'); conversation('t3', 'thread:p1')
  conversation('other', 'thread:p2', 'p2'); conversation('c1', 'code')
  return { db, store: new ThreadSectionsStore(db) }
}

const count = (db: AppDatabase, table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

describe('thread sections store (F13)', () => {
  it('stores the normalized state and reads it back', () => {
    const { store } = setup()
    expect(store.list('thread:p1')).toEqual({ sections: [], assignments: {} })
    const saved = store.save('thread:p1', {
      sections: [{ id: 'later', name: '  Later  ', order: 50 }, { id: 'now', name: 'Now', order: 7, collapsed: true }],
      assignments: { t2: 'later', t1: 'now', gone: 'now', other: 'now' }
    })
    const expected = {
      sections: [{ id: 'now', name: 'Now', order: 0, collapsed: true }, { id: 'later', name: 'Later', order: 1, collapsed: false }],
      // `gone` does not exist and `other` is a conversation of another workspace: both dropped, not refused.
      assignments: { t1: 'now', t2: 'later' }
    }
    expect(saved).toEqual({ ok: true, state: expected })
    expect(store.list('thread:p1')).toEqual(expected)
    expect(store.list('thread:p2')).toEqual({ sections: [], assignments: {} })
  })

  it('replaces the whole state on each save', () => {
    const { store } = setup()
    store.save('thread:p1', { sections: [{ id: 'a', name: 'A', order: 0 }, { id: 'b', name: 'B', order: 1 }], assignments: { t1: 'a', t2: 'b' } })
    expect(store.save('thread:p1', { sections: [{ id: 'b', name: 'Renamed', order: 0 }], assignments: { t3: 'b' } }))
      .toEqual({ ok: true, state: { sections: [{ id: 'b', name: 'Renamed', order: 0, collapsed: false }], assignments: { t3: 'b' } } })
  })

  it('keeps each workspace apart, Code workspaces included', () => {
    const { store } = setup()
    expect(store.save('code', { sections: [{ id: 'a', name: 'A', order: 0 }], assignments: { c1: 'a', t1: 'a' } })).toMatchObject({ ok: true, state: { assignments: { c1: 'a' } } })
    expect(store.save('thread:p2', { sections: [{ id: 'a', name: 'A', order: 0 }], assignments: { other: 'a' } })).toMatchObject({ ok: true })
    expect(store.list('code').sections).toHaveLength(1)
    expect(store.list('thread:p2').assignments).toEqual({ other: 'a' })
  })

  it('a refused save leaves the stored state untouched', () => {
    const { db, store } = setup()
    const stored = { sections: [{ id: 'a', name: 'A', order: 0, collapsed: false }], assignments: { t1: 'a' } }
    store.save('thread:p1', stored)
    for (const input of [
      { sections: [{ id: 'a', name: 'A', order: 0 }, { id: 'b', name: 'a', order: 1 }], assignments: {} },
      { sections: [{ id: 'a', name: '', order: 0 }], assignments: {} },
      { sections: [], assignments: { t1: 'missing' } },
      { sections: [], assignments: {}, extra: true },
      'nonsense'
    ]) {
      expect(store.save('thread:p1', input)).toMatchObject({ ok: false })
      expect(store.list('thread:p1')).toEqual(stored)
    }
    expect(count(db, 'thread_sections')).toBe(1)
  })

  it('refuses an unknown or nonsensical workspace and stores nothing', () => {
    const { db, store } = setup()
    const empty = { sections: [{ id: 'a', name: 'A', order: 0 }], assignments: {} }
    expect(store.save('thread:nope', empty)).toEqual({ ok: false, refusal: 'unknownWorkspace', message: { code: 'thread.sections.unknownWorkspace', params: {} } })
    expect(store.save('thread:', empty)).toMatchObject({ ok: false, refusal: 'unknownWorkspace' })
    expect(store.save('nope', empty)).toMatchObject({ ok: false, refusal: 'unknownWorkspace' })
    expect(store.save('', empty)).toMatchObject({ ok: false, refusal: 'invalid' })
    expect(store.save('x'.repeat(201), empty)).toMatchObject({ ok: false, refusal: 'invalid' })
    expect(store.save(null, empty)).toMatchObject({ ok: false, refusal: 'invalid' })
    expect(store.exists('thread:p1') && store.exists('code') && !store.exists('nope') && !store.exists('thread:')).toBe(true)
    expect(count(db, 'thread_sections')).toBe(0)
  })

  it('deleting a conversation removes its assignment', () => {
    const { db, store } = setup()
    store.save('thread:p1', { sections: [{ id: 'a', name: 'A', order: 0 }], assignments: { t1: 'a', t2: 'a' } })
    db.prepare("DELETE FROM conversation_threads WHERE id = 't1'").run()
    expect(store.list('thread:p1')).toEqual({ sections: [{ id: 'a', name: 'A', order: 0, collapsed: false }], assignments: { t2: 'a' } })
  })

  it('deleting a Code workspace removes its sections and their assignments', () => {
    const { db, store } = setup()
    store.save('code', { sections: [{ id: 'a', name: 'A', order: 0 }], assignments: { c1: 'a' } })
    store.save('thread:p1', { sections: [{ id: 'a', name: 'A', order: 0 }], assignments: { t1: 'a' } })
    db.prepare("DELETE FROM workspaces WHERE id = 'code'").run()
    expect(store.list('code')).toEqual({ sections: [], assignments: {} })
    expect(store.list('thread:p1').assignments).toEqual({ t1: 'a' })
    expect(count(db, 'thread_section_assignments')).toBe(1)
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('deleting a Thread project removes its sections and their assignments', () => {
    const { db, store } = setup()
    store.save('thread:p2', { sections: [{ id: 'a', name: 'A', order: 0 }], assignments: { other: 'a' } })
    // A project's conversations go first (conversation_threads keeps its project), then the project itself.
    db.prepare("DELETE FROM conversation_threads WHERE thread_project_id = 'p2'").run()
    db.prepare("DELETE FROM thread_projects WHERE id = 'p2'").run()
    expect(store.list('thread:p2')).toEqual({ sections: [], assignments: {} })
    expect(count(db, 'thread_sections')).toBe(0)
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('the schema refuses rows the validator would never write', () => {
    const { db } = setup()
    const insert = db.prepare('INSERT INTO thread_sections (workspace_id, code_workspace_id, thread_project_id, id, name, position) VALUES (?, ?, ?, ?, ?, ?)')
    expect(() => insert.run('thread:p1', 'code', 'p1', 'a', 'A', 0)).toThrow()
    expect(() => insert.run('thread:p2', null, 'p1', 'a', 'A', 0)).toThrow()
    expect(() => insert.run('thread:p1', null, 'p1', 'a', 'A', -1)).toThrow()
    insert.run('thread:p1', null, 'p1', 'a', 'Work', 0)
    expect(() => insert.run('thread:p1', null, 'p1', 'b', 'WORK', 1)).toThrow()
    expect(() => db.prepare("INSERT INTO thread_section_assignments (conversation_id, workspace_id, section_id) VALUES ('t1', 'thread:p1', 'missing')").run()).toThrow()
  })
})
