import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { removeTempDir } from '../helpers/removeTempDir'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadCheckpointService } from '../../electron/main/services/conversation/thread-checkpoints'

const roots: string[] = [], databases: AppDatabase[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const root of roots.splice(0)) removeTempDir(root)
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'oxespace-thread-checkpoint-')); roots.push(root)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git('init'); git('config', 'user.email', 'test@oxespace.local'); git('config', 'user.name', 'OXESpace Test')
  writeFileSync(join(root, 'tracked.txt'), 'base\n'); writeFileSync(join(root, 'dirty.txt'), 'committed\n')
  git('add', '.'); git('commit', '-m', 'base')
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Repo', ?, '1x1', 'builtin-powershell')").run(root)
  db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('project', ?, ?, 'Repo', 1, 1)").run(root, root)
  db.prepare("INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES ('thread', 'ws', 'project', '{}', '[]')").run()
  return { root, service: new ThreadCheckpointService(db) }
}

describe('Thread per-file undo', () => {
  it('undoes one file of a turn, leaves the others, and reports each file state', async () => {
    const { root, service } = fixture()
    const checkpoint = await service.begin({ threadId: 'thread', turnId: 'turn-1', rootPath: root })
    writeFileSync(join(root, 'tracked.txt'), 'agent edit\n')
    writeFileSync(join(root, 'new.txt'), 'created by agent\n')
    await service.finalize(checkpoint)
    expect(service.forTurn('thread', 'turn-1')?.id).toBe(checkpoint)

    expect(await service.restoreFile('thread', checkpoint, 'new.txt')).toBe('reverted')
    expect(existsSync(join(root, 'new.txt'))).toBe(false)
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('agent edit\n')
    const states = Object.fromEntries((await service.fileStates('thread', checkpoint)).map(file => [file.path, file.state]))
    expect(states).toEqual({ 'new.txt': 'reverted', 'tracked.txt': 'pending' })
    // Undoing an already reverted file is a no-op, not an error.
    expect(await service.restoreFile('thread', checkpoint, 'new.txt')).toBe('reverted')
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' })).toBe('')
  })

  it('refuses to undo a file edited after the turn, and never touches files outside the turn', async () => {
    const { root, service } = fixture()
    const checkpoint = await service.begin({ threadId: 'thread', turnId: 'turn-1', rootPath: root })
    writeFileSync(join(root, 'tracked.txt'), 'agent edit\n')
    await service.finalize(checkpoint)
    writeFileSync(join(root, 'tracked.txt'), 'user edit after the turn\n')
    expect((await service.fileStates('thread', checkpoint))[0].state).toBe('modified')
    await expect(service.restoreFile('thread', checkpoint, 'tracked.txt')).rejects.toThrow('changed after this turn')
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('user edit after the turn\n')
    await expect(service.restoreFile('thread', checkpoint, 'dirty.txt')).rejects.toThrow('not changed by this turn')
    await expect(service.restoreFile('thread', checkpoint, '../escape.txt')).rejects.toThrow('unsafe path')
    await expect(service.restoreFile('other-thread', checkpoint, 'tracked.txt')).rejects.toThrow('does not belong')
  })

  it('a whole-turn undo after a per-file undo restores the rest instead of conflicting', async () => {
    const { root, service } = fixture()
    const checkpoint = await service.begin({ threadId: 'thread', turnId: 'turn-1', rootPath: root })
    writeFileSync(join(root, 'tracked.txt'), 'agent edit\n')
    writeFileSync(join(root, 'new.txt'), 'created by agent\n')
    await service.finalize(checkpoint)
    await service.restoreFile('thread', checkpoint, 'tracked.txt')
    expect(await service.restore('thread', checkpoint)).toMatchObject({ state: 'restored' })
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('base\n')
    expect(existsSync(join(root, 'new.txt'))).toBe(false)
  })
})

describe('Thread file checkpoints', () => {
  it('restores clean, dirty and new files without touching the Git index', async () => {
    const { root, service } = fixture()
    writeFileSync(join(root, 'dirty.txt'), 'user work before turn\n')
    const checkpoint = await service.begin({ threadId: 'thread', turnId: 'turn-1', rootPath: root, label: 'Implement feature' })
    writeFileSync(join(root, 'tracked.txt'), 'agent edit\n')
    writeFileSync(join(root, 'dirty.txt'), 'agent edit over user work\n')
    writeFileSync(join(root, 'new.txt'), 'created by agent\n')
    expect(await service.finalize(checkpoint)).toMatchObject({ state: 'ready', fileCount: 3 })

    expect(await service.restore('thread', checkpoint)).toMatchObject({ state: 'restored', fileCount: 3 })
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('base\n')
    expect(readFileSync(join(root, 'dirty.txt'), 'utf8')).toBe('user work before turn\n')
    expect(existsSync(join(root, 'new.txt'))).toBe(false)
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' })).toBe('')
  })

  it('blocks the whole restore when any postimage changed later', async () => {
    const { root, service } = fixture()
    const checkpoint = await service.begin({ threadId: 'thread', turnId: 'turn-2', rootPath: root })
    writeFileSync(join(root, 'tracked.txt'), 'agent edit\n')
    writeFileSync(join(root, 'dirty.txt'), 'agent edit\n')
    await service.finalize(checkpoint)
    writeFileSync(join(root, 'tracked.txt'), 'user changed later\n')

    await expect(service.restore('thread', checkpoint)).rejects.toThrow('changed after this checkpoint')
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('user changed later\n')
    expect(readFileSync(join(root, 'dirty.txt'), 'utf8')).toBe('agent edit\n')
    expect(service.list('thread')[0]).toMatchObject({ state: 'conflict' })
    writeFileSync(join(root, 'tracked.txt'), 'agent edit\n')
    await expect(service.restore('thread', checkpoint)).resolves.toMatchObject({ state: 'restored' })
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('base\n')
  })

  it('isolates checkpoints by conversation', async () => {
    const { root, service } = fixture()
    const checkpoint = await service.begin({ threadId: 'thread', turnId: 'turn-3', rootPath: root })
    writeFileSync(join(root, 'tracked.txt'), 'agent edit\n')
    await service.finalize(checkpoint)
    await expect(service.restore('another-thread', checkpoint)).rejects.toThrow('does not belong')
  }, 15000)
})

describe('Thread per-change undo', () => {
  const base = 'one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\n'
  async function turn() {
    const f = fixture()
    writeFileSync(join(f.root, 'tracked.txt'), base)
    execFileSync('git', ['commit', '-am', 'crlf'], { cwd: f.root, stdio: 'pipe' })
    const checkpoint = await f.service.begin({ threadId: 'thread', turnId: 'turn-1', rootPath: f.root })
    writeFileSync(join(f.root, 'tracked.txt'), 'one\r\nTWO\r\nthree\r\nfour\r\nFIVE\r\nsix\r\nseven\r\n')
    await f.service.finalize(checkpoint)
    return { ...f, checkpoint }
  }

  it('lists change blocks, undoes one byte-exactly, and keeps file and turn undo working afterwards', { timeout: 30_000 }, async () => {
    const { root, service, checkpoint } = await turn()
    const hunks = await service.fileHunks('thread', checkpoint, 'tracked.txt')
    expect(hunks.map(hunk => [hunk.oldLines, hunk.newLines])).toEqual([[['two\r'], ['TWO\r']], [['five\r'], ['FIVE\r']], [[], ['seven\r']]])
    await service.restoreHunk('thread', checkpoint, 'tracked.txt', hunks[1].id)
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('one\r\nTWO\r\nthree\r\nfour\r\nfive\r\nsix\r\nseven\r\n')
    expect((await service.fileStates('thread', checkpoint))[0].state).toBe('pending')
    expect((await service.fileHunks('thread', checkpoint, 'tracked.txt')).length).toBe(2)
    // The same block cannot be undone twice.
    await expect(service.restoreHunk('thread', checkpoint, 'tracked.txt', hunks[1].id)).rejects.toThrow('no longer in the file')
    await service.restore('thread', checkpoint)
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe(base)
  })

  it('refuses block review for a file edited after the turn and lists none for a new file', { timeout: 30_000 }, async () => {
    const { root, service, checkpoint } = await turn()
    writeFileSync(join(root, 'tracked.txt'), 'user rewrite\n')
    await expect(service.fileHunks('thread', checkpoint, 'tracked.txt')).rejects.toThrow('changed after this turn')
    const second = await service.begin({ threadId: 'thread', turnId: 'turn-2', rootPath: root })
    writeFileSync(join(root, 'created.txt'), 'new\n')
    await service.finalize(second)
    expect(await service.fileHunks('thread', second, 'created.txt')).toEqual([])
  })
})
