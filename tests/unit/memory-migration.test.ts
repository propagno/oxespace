// @vitest-environment node
import { expect, test } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryMigration } from '../../electron/main/services/memory/memory-migration'
import type { MemoryRuntimeSettings } from '../../shared/types/memory'

const old: MemoryRuntimeSettings = { mode: 'managed', executable: 'old', url: 'http://127.0.0.1:1' }
const next: MemoryRuntimeSettings = { ...old, executable: 'new' }

test.each(['copied', 'validated', 'snapshot', 'swapped', 'settings'])('restores the complete old snapshot after failure at %s', async phase => {
  const directory = await mkdtemp(join(tmpdir(), 'oxe-memory-upgrade-test-'))
  const data = join(directory, 'data')
  let settings = old
  try {
    await mkdir(data)
    await writeFile(join(data, 'store.sqlite'), 'old-database')
    await writeFile(join(data, 'store.sqlite-wal'), 'old-wal')
    await writeFile(join(data, 'auth-token'), 'synthetic-token')
    await writeFile(join(directory, 'local.toml'), 'old-config')
    const migration = new MemoryMigration(directory, value => { settings = value }, async point => {
      if (point === phase) throw Error(`interrupted-${point}`)
    })
    await expect(migration.upgrade(old, next, 'new-config', async candidate => {
      expect(await readFile(join(candidate, 'store.sqlite-wal'), 'utf8')).toBe('old-wal')
      await writeFile(join(candidate, 'store.sqlite'), 'migrated-database')
    })).rejects.toThrow(`interrupted-${phase}`)
    // Recovery is idempotent if a process restarts after the failed attempt.
    await new MemoryMigration(directory, value => { settings = value }).recover()
    expect(settings).toEqual(old)
    expect(await readFile(join(data, 'store.sqlite'), 'utf8')).toBe('old-database')
    expect(await readFile(join(data, 'store.sqlite-wal'), 'utf8')).toBe('old-wal')
    expect(await readFile(join(data, 'auth-token'), 'utf8')).toBe('synthetic-token')
    expect(await readFile(join(directory, 'local.toml'), 'utf8')).toBe('old-config')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('committed upgrade retains a rollback snapshot and preserves newer writes separately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oxe-memory-upgrade-test-'))
  const data = join(directory, 'data')
  let settings = old
  try {
    await mkdir(data)
    await writeFile(join(data, 'store.sqlite'), 'old-database')
    const migration = new MemoryMigration(directory, value => { settings = value })
    await migration.upgrade(old, next, 'new-config', async candidate => {
      await writeFile(join(candidate, 'store.sqlite'), 'migrated-database')
    })
    expect(settings).toEqual(next)
    expect(await readFile(join(data, 'store.sqlite'), 'utf8')).toBe('migrated-database')
    await writeFile(join(data, 'new-writes'), 'retain-me')
    expect(await migration.rollback(old)).toBe(true)
    expect(settings).toEqual(old)
    expect(await readFile(join(data, 'store.sqlite'), 'utf8')).toBe('old-database')
    expect(await readFile(join(migration.displaced, 'new-writes'), 'utf8')).toBe('retain-me')
    expect(await readdir(data)).toEqual(['store.sqlite'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('rejects a linked path inside a snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oxe-memory-upgrade-test-'))
  try {
    await mkdir(join(directory, 'data'))
    await mkdir(join(directory, 'outside'))
    const { symlink } = await import('node:fs/promises')
    await symlink(join(directory, 'outside'), join(directory, 'data', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const migration = new MemoryMigration(directory, () => {})
    await expect(migration.upgrade(old, next, 'new-config', async () => {})).rejects.toThrow('unsupported file type')
    expect((await readdir(directory)).sort()).toEqual(['data', 'outside'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('recovers an interrupted swap from its journal before opening either runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oxe-memory-upgrade-test-'))
  let settings = next
  try {
    const migration = new MemoryMigration(directory, value => { settings = value })
    await mkdir(migration.root)
    await mkdir(migration.snapshot)
    await mkdir(join(directory, 'data'))
    await writeFile(join(migration.snapshot, 'store.sqlite'), 'old-database')
    await writeFile(join(directory, 'data', 'store.sqlite'), 'new-database')
    await writeFile(migration.journalPath, JSON.stringify({ phase: 'switching', from: old, to: next, config: 'old-config' }))
    await migration.recover()
    expect(settings).toEqual(old)
    expect(await readFile(join(directory, 'data', 'store.sqlite'), 'utf8')).toBe('old-database')
    expect(await readFile(join(migration.displaced, 'store.sqlite'), 'utf8')).toBe('new-database')
    expect(await readFile(join(directory, 'local.toml'), 'utf8')).toBe('old-config')
    await migration.recover()
    expect(await readFile(join(directory, 'data', 'store.sqlite'), 'utf8')).toBe('old-database')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
