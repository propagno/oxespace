import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const execGitMock = vi.fn()

vi.mock('../../../electron/main/utils/safe-git', () => ({
  execGit: (...args: unknown[]) => execGitMock(...args)
}))

import { projectIdentity } from '../../../electron/main/services/project-identity'

function normalizeIdentity(path: string): string {
  return process.platform === 'win32' ? path.replace(/\\/g, '/').toLowerCase() : path
}

describe('OXE-352 · projectIdentity dubious ownership fallback', () => {
  let dir: string

  beforeEach(async () => {
    execGitMock.mockReset()
    dir = await mkdtemp(join(tmpdir(), 'oxe352-dubious-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('falls back cleanly to canonical folder identity on git dubious ownership without throwing', async () => {
    const canonical = await realpath(dir)
    const err = Object.assign(new Error('Command failed: git rev-parse'), {
      code: 128,
      stderr: `fatal: detected dubious ownership in repository at '${canonical}'\nTo add an exception for this directory, call:\n\tgit config --global --add safe.directory ${canonical}\n`
    })
    execGitMock.mockRejectedValueOnce(err)

    await expect(projectIdentity(dir)).resolves.toBe(normalizeIdentity(canonical))
    expect(execGitMock).toHaveBeenCalledTimes(1)
  })

  test('falls back cleanly to canonical folder identity when folder is not a git repository', async () => {
    const canonical = await realpath(dir)
    const err = Object.assign(new Error('Command failed: git rev-parse'), {
      code: 128,
      stderr: 'fatal: not a git repository (or any of the parent directories): .git\n'
    })
    execGitMock.mockRejectedValueOnce(err)

    await expect(projectIdentity(dir)).resolves.toBe(normalizeIdentity(canonical))
    expect(execGitMock).toHaveBeenCalledTimes(1)
  })

  test('still fails closed on permission errors instead of minting a folder identity', async () => {
    const err = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
      stderr: 'fatal: cannot open .git/HEAD: Permission denied'
    })
    execGitMock.mockRejectedValueOnce(err)

    await expect(projectIdentity(dir)).rejects.toThrow('permission denied')
    expect(execGitMock).toHaveBeenCalledTimes(1)
  })

  test('still fails closed after two timeouts instead of minting a folder identity', async () => {
    const err = Object.assign(new Error('probe timed out'), { killed: true, stderr: '' })
    execGitMock.mockRejectedValue(err)

    await expect(projectIdentity(dir)).rejects.toThrow('probe timed out')
    expect(execGitMock).toHaveBeenCalledTimes(2)
  })
})
