import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FileSystemService, MAX_TEXT_FILE_BYTES } from '../../electron/main/services/file-system.service'

describe('FileSystemService', () => {
  let rootPath: string
  let service: FileSystemService

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'oxespace-fs-'))
    service = new FileSystemService()

    await mkdir(join(rootPath, 'src'), { recursive: true })
    await mkdir(join(rootPath, 'node_modules'), { recursive: true })
    await mkdir(join(rootPath, '.git'), { recursive: true })
    await mkdir(join(rootPath, 'dist'), { recursive: true })
    await writeFile(join(rootPath, 'src', 'index.ts'), 'export const value = 1\n', 'utf8')
    await writeFile(join(rootPath, 'README.md'), '# Readme\n', 'utf8')
    await writeFile(join(rootPath, 'node_modules', 'hidden.ts'), 'hidden\n', 'utf8')
    await writeFile(join(rootPath, '.git', 'config'), 'hidden\n', 'utf8')
    await writeFile(join(rootPath, 'dist', 'bundle.js'), 'hidden\n', 'utf8')
  })

  afterEach(async () => {
    service.closeAll()
    await rm(rootPath, { recursive: true, force: true })
  })

  test('lists workspace tree and excludes generated directories', async () => {
    const tree = await service.listTree({ workspaceId: 'workspace-1', rootPath })
    const names = tree.map((node) => node.name)

    expect(names).toContain('src')
    expect(names).toContain('README.md')
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.git')
    expect(names).not.toContain('dist')
    expect(tree.find((node) => node.name === 'src')?.children).toBeUndefined()

    const srcTree = await service.listTree({ workspaceId: 'workspace-1', rootPath, relativePath: 'src' })
    expect(srcTree[0]).toMatchObject({
      name: 'index.ts',
      relativePath: 'src/index.ts',
      type: 'file'
    })
  })

  test('blocks traversal and absolute paths before filesystem access', async () => {
    await expect(service.readFile({ workspaceId: 'workspace-1', rootPath, relativePath: '../secret.txt' })).rejects.toThrow(
      'Path escapes workspace root'
    )
    await expect(service.readFile({ workspaceId: 'workspace-1', rootPath, relativePath: join(rootPath, '..', 'secret.txt') })).rejects.toThrow(
      'Path escapes workspace root'
    )
    await expect(service.writeFile({ workspaceId: 'workspace-1', rootPath, relativePath: '..\\secret.txt', content: 'x' })).rejects.toThrow(
      'Path escapes workspace root'
    )
  })

  test('uses the workspace registry as the authoritative root', async () => {
    const guarded = new FileSystemService((workspaceId) => workspaceId === 'workspace-1' ? rootPath : null)
    await expect(guarded.readFile({
      workspaceId: 'workspace-1',
      rootPath: join(rootPath, 'src'),
      relativePath: 'index.ts'
    })).rejects.toThrow('does not match')
    await expect(guarded.readFile({
      workspaceId: 'missing',
      rootPath,
      relativePath: 'README.md'
    })).rejects.toThrow('not found')
  })

  test('blocks canonical paths that escape through a junction', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'oxespace-fs-outside-'))
    try {
      await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
      await symlink(outside, join(rootPath, 'linked-outside'), 'junction')
      await expect(service.readFile({
        workspaceId: 'workspace-1',
        rootPath,
        relativePath: 'linked-outside/secret.txt'
      })).rejects.toThrow('resolves outside')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('reads and writes text files inside the workspace', async () => {
    const readResult = await service.readFile({ workspaceId: 'workspace-1', rootPath, relativePath: 'src/index.ts' })
    expect(readResult.content).toBe('export const value = 1\n')

    const writeResult = await service.writeFile({
      workspaceId: 'workspace-1',
      rootPath,
      relativePath: 'src/index.ts',
      content: 'export const value = 2\n'
    })
    expect(writeResult.relativePath).toBe('src/index.ts')
    await expect(readFile(join(rootPath, 'src', 'index.ts'), 'utf8')).resolves.toBe('export const value = 2\n')
  })

  test('blocks large and binary files', async () => {
    await writeFile(join(rootPath, 'large.txt'), 'a'.repeat(MAX_TEXT_FILE_BYTES + 1), 'utf8')
    await writeFile(join(rootPath, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02]))

    await expect(service.readFile({ workspaceId: 'workspace-1', rootPath, relativePath: 'large.txt' })).rejects.toThrow('larger than 2 MB')
    await expect(service.writeFile({ workspaceId: 'workspace-1', rootPath, relativePath: 'README.md', content: 'a'.repeat(MAX_TEXT_FILE_BYTES + 1) })).rejects.toThrow(
      'larger than 2 MB'
    )
    await expect(service.readFile({ workspaceId: 'workspace-1', rootPath, relativePath: 'binary.bin' })).rejects.toThrow('Binary files')
  })

  test('emits changes for watched files', async () => {
    const onChanged = vi.fn()
    const { watchId } = await service.watchFile({ workspaceId: 'workspace-1', rootPath, relativePath: 'README.md' }, onChanged)

    await writeFile(join(rootPath, 'README.md'), '# Updated\n', 'utf8')
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ watchId, relativePath: 'README.md', content: '# Updated\n' }))
    }, { timeout: 1500 })

    service.unwatchFile(watchId)
  })
})
