// B17 · HML FINDING M (S2, run 41321809846): Claude Code names its transcript folder after the cwd it sees, which is not
// always the root as OXESpace stored it (8.3 short form, letter case, junction or symlink). Temp folders only: nothing
// here reads the real ~/.claude, and no provider runs.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { nativeSessionExists, type NativeSessionRoots } from '../electron/main/services/agent-state/native-session-files'
import { encodeClaudeProjectPath } from '../electron/main/services/usage/claude-project-path'

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const CODEX_ID = '019a5c1e-7b2d-7c3e-9f00-112233445566'

let dir: string
let root: string
let roots: Required<NativeSessionRoots>

beforeEach(() => {
  // The long, canonical form, so a folder name built from it decodes through the real folders on any runner.
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-b17-paths-')))
  root = join(dir, 'repo')
  mkdirSync(root)
  roots = { claudeProjects: join(dir, 'claude', 'projects'), codexSessions: join(dir, 'codex', 'sessions') }
  mkdirSync(roots.claudeProjects, { recursive: true })
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function transcriptIn(folder: string, id = ID): void {
  mkdirSync(join(roots.claudeProjects, folder), { recursive: true })
  writeFileSync(join(roots.claudeProjects, folder, `${id}.jsonl`), '{}\n')
}

/** A link to a folder: a junction on Windows (no admin needed), a symlink elsewhere. */
function link(target: string, path: string): void {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

const swapCase = (text: string): string => [...text].map(c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()).join('')

describe('Claude Code: the transcript folder for the pane root', () => {
  test('the stored root, as before', async () => {
    transcriptIn(encodeClaudeProjectPath(root))
    expect(await nativeSessionExists('claude', ID, root, roots)).toBe(true)
  })

  test('an 8.3 short root (RUNNER~1) finds the folder Claude named after the long path', async () => {
    const short = join(dir, 'RUNNER~1', 'repo')
    const long = join(dir, 'runneradmin', 'repo')
    mkdirSync(long, { recursive: true })
    transcriptIn(encodeClaudeProjectPath(long))
    // What realpath.native does on Windows: expand the short name. Everything else resolves for real.
    const fs = { realpath: async (path: string) => realpath(path === short ? long : path) }
    expect(await nativeSessionExists('claude', ID, short, roots, fs)).toBe(true)
    // Without the expansion (the stored form only, as before) the folder is not this root's.
    expect(await nativeSessionExists('claude', ID, short, roots, { realpath: async (path: string) => path })).toBe(false)
  })

  test('a letter-case difference matches on Windows only', async () => {
    transcriptIn(swapCase(encodeClaudeProjectPath(root)))
    expect(await nativeSessionExists('claude', ID, root, roots, { platform: 'win32' })).toBe(true)
    // On a case-sensitive file system the other case is another folder.
    if (process.platform === 'linux') expect(await nativeSessionExists('claude', ID, root, roots, { platform: 'linux' })).toBe(false)
  })

  test('a root stored through a link finds the folder named after its target', async () => {
    const alias = join(dir, 'alias')
    link(root, alias)
    transcriptIn(encodeClaudeProjectPath(root))
    expect(await nativeSessionExists('claude', ID, alias, roots)).toBe(true)
  })

  test('a folder Claude named after a link to the root is found by decoding it through the folders on disk', async () => {
    const alias = join(dir, 'alias.link')
    link(root, alias)
    transcriptIn(encodeClaudeProjectPath(alias))
    expect(await nativeSessionExists('claude', ID, root, roots)).toBe(true)
  })

  test('the same id under another project\'s folder is never accepted', async () => {
    const other = join(dir, 'other')
    mkdirSync(other)
    transcriptIn(encodeClaudeProjectPath(other))
    // A link to the other project, and a name that decodes to nothing on disk.
    const otherAlias = join(dir, 'other-alias')
    link(other, otherAlias)
    transcriptIn(encodeClaudeProjectPath(otherAlias))
    transcriptIn(`${encodeClaudeProjectPath(root)}-gone`)
    expect(await nativeSessionExists('claude', ID, root, roots)).toBe(false)
    expect(await nativeSessionExists('claude', ID, root, roots, { platform: 'win32' })).toBe(false)
  })

  test('a project folder that links outside the projects folder is not followed', async () => {
    const outside = join(dir, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, `${ID}.jsonl`), '{}\n')
    link(outside, join(roots.claudeProjects, encodeClaudeProjectPath(root)))
    expect(await nativeSessionExists('claude', ID, root, roots)).toBe(false)
  })

  test('only a UUID, and a missing projects folder or root is a plain false', async () => {
    transcriptIn(encodeClaudeProjectPath(root), 'abc-123')
    expect(await nativeSessionExists('claude', 'abc-123', root, roots)).toBe(false)
    expect(await nativeSessionExists('claude', ID, root, { claudeProjects: join(dir, 'nowhere') })).toBe(false)
    expect(await nativeSessionExists('claude', ID, join(dir, 'deleted'), roots)).toBe(false)
  })
})

describe('Codex: unchanged, found by id', () => {
  test('a rollout named after the id, whatever the cwd', async () => {
    const day = join(roots.codexSessions, '2026', '10', '31')
    mkdirSync(day, { recursive: true })
    writeFileSync(join(day, `rollout-2026-10-31T09-00-00-${CODEX_ID}.jsonl`), '{}\n')
    expect(await nativeSessionExists('codex', CODEX_ID, join(dir, 'RUNNER~1', 'elsewhere'), roots)).toBe(true)
    expect(await nativeSessionExists('codex', ID, root, roots)).toBe(false)
  })
})
