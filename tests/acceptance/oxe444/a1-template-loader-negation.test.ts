// @vitest-environment node
// Frozen acceptance test for OXE-444 (A1): multi-source template loader + .worktreeinclude !negation rules.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadRepoConfig, loadWorktreeTemplate } from '../../../electron/main/services/repo-config/loader'
import { parseOrcaYaml, parseWorktreeInclude } from '../../../electron/main/services/repo-config/parser'
import { copyIncludedFiles, INCLUDE_LIMITS } from '../../../electron/main/services/repo-config/worktree-include'
import { removeTempDir } from '../../helpers/removeTempDir'

let sandbox: string
let root: string
let tree: string

function put(base: string, rel: string, text = rel): void {
  const file = join(base, ...rel.split('/'))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function linkDir(target: string, at: string): boolean {
  try {
    symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir')
    return true
  } catch {
    return false
  }
}

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe444-a1-')))
  root = join(sandbox, 'repo')
  tree = join(sandbox, 'tree')
  mkdirSync(join(root, '.git'), { recursive: true })
  mkdirSync(tree, { recursive: true })
})

afterEach(() => {
  try { removeTempDir(sandbox) } catch { /* temp dir */ }
})

describe('OXE-444 A1 · multi-source template loader and .worktreeinclude !pattern negations', () => {
  it('merges oxe.yaml, .oxe/worktree.yaml, orca.yaml and .worktreeinclude with deterministic precedence and sources attribution', async () => {
    const parsedOrca = parseOrcaYaml(`
sharedDirectories:
  - .venv
  - node_modules
setupCommand: npm run orca-setup
archive: echo orca-archive
copyFiles:
  - config/orca.local.json
`)
    expect(parsedOrca?.worktree.sharedDirectories).toEqual(['.venv', 'node_modules'])
    expect(parsedOrca?.scripts.setup).toBe('npm run orca-setup')
    expect(parsedOrca?.scripts.archive).toBe('echo orca-archive')

    const parsedInclude = parseWorktreeInclude(`
# comment line

.env*
!.env.production
config\\*.local.json
\\#literal.txt
`)
    expect(parsedInclude).toEqual(['.env*', '!.env.production', 'config/*.local.json', '#literal.txt'])

    // Write all four template sources to verify deterministic precedence: oxe.yaml > .oxe/worktree.yaml > orca.yaml, + .worktreeinclude
    put(root, 'orca.yaml', 'sharedDirectories: [.venv, .cache]\nsetup: echo from-orca\narchive: echo archive-orca\ncopyFiles: [config/orca.local.json]\n')
    put(root, '.oxe/worktree.yaml', 'scripts:\n  setup: echo from-dot-oxe\n  archive: echo archive-dot-oxe\nworktree:\n  sharedDirectories: [.pnpm-store, .cache]\n  copyFiles: [config/oxe-dir.local.json]\n')
    put(root, 'oxe.yaml', 'scripts:\n  setup: echo from-oxe\nworktree:\n  sharedDirectories: [node_modules]\n  copyFiles: [config/oxe.local.json]\n')
    put(root, '.worktreeinclude', '# Claude Code include\n.env*\n!.env.production\nconfig/oxe.local.json\n')

    const loaded = await loadWorktreeTemplate(root)
    expect(loaded.sources).toEqual(['oxe.yaml', '.oxe/worktree.yaml', 'orca.yaml', '.worktreeinclude'])
    expect(loaded.config?.scripts.setup).toBe('echo from-oxe')
    expect(loaded.config?.scripts.archive).toBe('echo archive-dot-oxe')
    expect(loaded.config?.worktree.sharedDirectories).toEqual(['node_modules', '.pnpm-store', '.cache', '.venv'])
    expect(loaded.config?.worktree.copyFiles).toEqual([
      'config/oxe.local.json',
      'config/oxe-dir.local.json',
      'config/orca.local.json',
      '.env*',
      '!.env.production'
    ])

    const merged = await loadRepoConfig(root)
    expect(merged?.sources).toEqual(['oxe.yaml', '.oxe/worktree.yaml', 'orca.yaml', '.worktreeinclude'])
    expect(merged?.scripts.setup).toBe('echo from-oxe')
  })

  it('evaluates order-sensitive !pattern negations including nested paths and re-inclusion while preserving security guards', async () => {
    put(root, '.env', 'A=1')
    put(root, '.env.local', 'B=2')
    put(root, '.env.production', 'PROD=1')
    put(root, '.env.production.local', 'PROD_LOCAL=1')
    put(root, 'apps/web/.env.local', 'WEB=1')
    put(root, 'apps/web/.env.production', 'WEB_PROD=1')
    put(root, 'config/dev.local.json', '{"dev":true}')
    put(root, 'config/prod.local.json', '{"prod":true}')
    put(root, 'config/keep.local.json', '{"keep":true}')
    put(tree, 'config/keep.local.json', '{"existing":true}')

    const outsideDir = join(sandbox, 'outside-secret')
    put(outsideDir, 'leak.txt', 'nope')
    linkDir(outsideDir, join(root, 'linked'))

    const report = await copyIncludedFiles(
      root,
      tree,
      [
        '.env*',
        '!.env.production',
        '!.env.production.local',
        '.env.production.local',
        'apps/**/.env*',
        '!.env.production',
        'config/*.local.json',
        '!config/prod.local.json',
        'linked/leak.txt',
        '!../outside.txt',
        '!.git/config'
      ],
      undefined,
      { sensitiveApproved: true }
    )

    expect(report.copied.sort()).toEqual([
      '.env',
      '.env.local',
      '.env.production.local',
      'apps/web/.env.local',
      'config/dev.local.json'
    ])
    expect(existsSync(join(tree, '.env.production'))).toBe(false)
    expect(existsSync(join(tree, 'apps', 'web', '.env.production'))).toBe(false)
    expect(existsSync(join(tree, 'config', 'prod.local.json'))).toBe(false)
    expect(readFileSync(join(tree, 'config', 'keep.local.json'), 'utf8')).toBe('{"existing":true}')
    expect(existsSync(join(tree, 'linked'))).toBe(false)

    expect(report.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '.env.production', reason: 'excluded-by-negation' }),
        expect.objectContaining({ path: 'apps/web/.env.production', reason: 'excluded-by-negation' }),
        expect.objectContaining({ path: 'config/prod.local.json', reason: 'excluded-by-negation' }),
        expect.objectContaining({ path: '!../outside.txt', reason: 'outside-repo' }),
        expect.objectContaining({ path: '!.git/config', reason: 'outside-repo' })
      ])
    )
    expect(report.notices).toContainEqual({
      code: 'worktree.copyFiles.outsideRepo',
      params: { patterns: ['!../outside.txt', '!.git/config'] }
    })

    // Limits still hold after negation
    const overRoot = join(sandbox, 'over-repo')
    const overTree = join(sandbox, 'over-tree')
    mkdirSync(join(overRoot, '.git'), { recursive: true })
    mkdirSync(overTree, { recursive: true })
    for (let i = 0; i <= INCLUDE_LIMITS.files; i++) put(overRoot, `many/f${i}.txt`, 'x')
    const over = await copyIncludedFiles(overRoot, overTree, ['many/*.txt'], undefined, { sensitiveApproved: true })
    expect(over.copied).toEqual([])
    expect(over.notices.some((n) => n.code === 'worktree.copyFiles.overLimit')).toBe(true)
  })
})
