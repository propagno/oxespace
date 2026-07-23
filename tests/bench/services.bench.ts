/**
 * Real child-process and filesystem benchmarks for the service layer.
 *
 * Fixtures are created once in the OS temp directory so measured samples cover
 * SearchService/GitService work rather than fixture generation.
 */
import { afterAll, beforeAll, bench, describe } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppDatabase } from '../../electron/main/db/index'
import { GitHubService } from '../../electron/main/services/github.service'
import { GitService } from '../../electron/main/services/git.service'
import { SearchService } from '../../electron/main/services/search.service'

let searchRoot = ''
let gitRoot = ''

beforeAll(() => {
  searchRoot = mkdtempSync(join(tmpdir(), 'oxe-perf-search-'))
  for (let directory = 0; directory < 20; directory++) {
    const dir = join(searchRoot, `src-${directory}`)
    mkdirSync(dir, { recursive: true })
    for (let file = 0; file < 100; file++) {
      const id = directory * 100 + file
      const marker = id % 10 === 0 ? 'PERFORMANCE_NEEDLE' : 'ordinary content'
      writeFileSync(
        join(dir, `module-${id}.ts`),
        `export const module${id} = ${id}\n// ${marker}\n${'const value = 42\n'.repeat(40)}`
      )
    }
  }

  gitRoot = mkdtempSync(join(tmpdir(), 'oxe-perf-git-'))
  execFileSync('git', ['init', '-q'], { cwd: gitRoot })
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: gitRoot })
  execFileSync('git', ['config', 'user.email', 'perf@oxespace.local'], { cwd: gitRoot })
  execFileSync('git', ['config', 'user.name', 'OXESpace Perf'], { cwd: gitRoot })
  for (let file = 0; file < 300; file++) {
    writeFileSync(join(gitRoot, `file-${file}.txt`), `baseline ${file}\n`)
  }
  execFileSync('git', ['add', '.'], { cwd: gitRoot })
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: gitRoot })
  for (let file = 0; file < 100; file++) {
    writeFileSync(join(gitRoot, `file-${file}.txt`), `baseline ${file}\nchanged ${file}\n`)
  }
})

afterAll(() => {
  if (searchRoot) rmSync(searchRoot, { recursive: true, force: true })
  if (gitRoot) rmSync(gitRoot, { recursive: true, force: true })
})

const serviceBenchOptions = {
  time: 1_000,
  iterations: 5,
  warmupTime: 200,
  warmupIterations: 1
}

describe('SearchService — real bundled ripgrep over 2,000 files', () => {
  const service = new SearchService()

  bench('listFiles — 2,000 files', async () => {
    await service.listFiles(searchRoot)
  }, serviceBenchOptions)

  bench('literal search — 200 matching files', async () => {
    await service.search({
      workspaceId: 'perf',
      rootPath: searchRoot,
      query: 'PERFORMANCE_NEEDLE'
    })
  }, serviceBenchOptions)

  bench('no-result search — 2,000 files', async () => {
    await service.search({
      workspaceId: 'perf',
      rootPath: searchRoot,
      query: 'THIS_TOKEN_DOES_NOT_EXIST'
    })
  }, serviceBenchOptions)
})

describe('GitService — real Git repo with 300 files / 100 modified', () => {
  const service = new GitService()
  const githubService = new GitHubService(null as unknown as AppDatabase)
  let commitSequence = 0

  bench('getBranch', async () => {
    await service.getBranch(gitRoot)
  }, serviceBenchOptions)

  bench('buildDiff — 100 modified files', async () => {
    await service.buildDiff(gitRoot, 'HEAD', true)
  }, serviceBenchOptions)

  bench('stage + unstage — one file', async () => {
    await githubService.stageFile({ workspaceId: 'perf', rootPath: gitRoot, path: 'file-0.txt' })
    await githubService.unstageFile({ workspaceId: 'perf', rootPath: gitRoot, path: 'file-0.txt' })
  }, serviceBenchOptions)

  bench('stage + commit — one new file', async () => {
    const path = `commit-perf-${commitSequence++}.txt`
    writeFileSync(join(gitRoot, path), `commit benchmark ${commitSequence}\n`)
    await githubService.stageFile({ workspaceId: 'perf', rootPath: gitRoot, path })
    await githubService.commit({
      workspaceId: 'perf',
      rootPath: gitRoot,
      message: `perf: sample ${commitSequence}`
    })
  }, serviceBenchOptions)
})
