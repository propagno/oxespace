// @vitest-environment node
/**
 * Every git the main process runs goes through electron/main/utils/safe-git.ts (local) or safe-git-person.ts (the
 * person's fetch, pull and push): a repository an agent can write names commands git would otherwise run, with no
 * click (SECURITY S4-1). This scans electron/main for any other way to start git or gh and fails on one that is not
 * on the allowlist below, where each entry says why it may.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

// Reads every main source file; a loaded Windows box needs room.
vi.setConfig({ testTimeout: 60_000 })

const ROOT = join(__dirname, '..', '..')
const MAIN = join(ROOT, 'electron', 'main')

/** The modules that are the way to git. */
const SAFE_MODULES = new Set(['electron/main/utils/safe-git.ts', 'electron/main/utils/safe-git-person.ts'])

/** file -> why it may start git or gh itself. Each entry needs a reason a reviewer can check. */
const ALLOWLIST: Record<string, string> = {
  'electron/main/e2e/mock-ipc.ts': 'E2E mock IPC, loaded only by OXESPACE_E2E mock launches (tests/unit/main-entry-imports.test.ts); its git lists branches and worktrees of the fixture repo the test made.',
  'electron/main/services/copilotCredits.service.ts': 'gh only, with ghEnv() from safe-git (no GIT_* of main, no hooks, no fsmonitor, no ext::); runs `gh api` with no repository as cwd.',
  'electron/main/services/github/gh-exec.ts': "gh only: `gh --version` through GhExec.spawn, which gives every command ghEnv() and refuses git; GhExec's git goes through prepareGit / preparePersonGit."
}

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.(ts|mts|cts|js|cjs|mjs)$/.test(name) && !/\.test\./.test(name) && !name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

/** Comments out, so a doc comment that quotes `execFile('git', …)` is not a call. Strings and template text stay. */
const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

const GIT_OR_GH = String.raw`['"\x60](?:git|gh)(?:\.exe)?['"\x60]`
/** A call whose first argument is the literal git or gh: spawn('git', …), exec('gh', …), this.spawn('git', …), over lines. */
const LITERAL_CALL = new RegExp(String.raw`\b[\w$.]+\s*\(\s*${GIT_OR_GH}\s*,`, 'g')
/** A shell string that starts with git or gh: exec('git status'), execSync(`gh pr list`). */
const SHELL_STRING = new RegExp(String.raw`\b(?:exec|execSync|spawn|spawnSync)\s*\(\s*['"\x60](?:git|gh)\s`, 'g')
/** Libraries that run git with their own environment. */
const LIBRARIES = /from\s+['"](?:simple-git|isomorphic-git|nodegit|dugite|execa)['"]|require\(\s*['"](?:simple-git|isomorphic-git|nodegit|dugite)['"]\s*\)/g

function findGitSpawns(source: string): string[] {
  const text = withoutComments(source)
  const found: string[] = []
  for (const re of [LITERAL_CALL, SHELL_STRING, LIBRARIES]) {
    for (const match of text.matchAll(re)) {
      // Not a process: a Set/array/includes of names, a message key, a path join.
      if (/^(?:new\s+Set|includes|has|push|join|resolve|mainMessage|t|startsWith|endsWith|test|indexOf|equal|basename|Symbol\.for)\s*\(/.test(match[0])) continue
      const line = text.slice(0, match.index).split('\n').length
      found.push(`${line}: ${match[0].replace(/\s+/g, ' ')}`)
    }
  }
  return found
}

describe('main-process git goes through safe-git', () => {
  test('no file outside the safe modules and the allowlist starts git or gh', () => {
    const offenders: string[] = []
    for (const file of sources(MAIN)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/')
      if (SAFE_MODULES.has(rel) || rel in ALLOWLIST) continue
      for (const hit of findGitSpawns(readFileSync(file, 'utf8'))) offenders.push(`${rel}:${hit}`)
    }
    expect(offenders, 'route these through electron/main/utils/safe-git.ts (or add an allowlist entry with a reason)').toEqual([])
  })

  test('every allowlist entry exists, still needs its place and says why', () => {
    for (const [rel, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, rel).toBeGreaterThan(40)
      expect(findGitSpawns(readFileSync(join(ROOT, rel), 'utf8')), `${rel} no longer starts git or gh; drop it from the allowlist`).not.toEqual([])
    }
  })

  test('allowlisted gh starters give gh the safe environment', () => {
    for (const rel of ['electron/main/services/copilotCredits.service.ts', 'electron/main/services/github/gh-exec.ts']) {
      expect(readFileSync(join(ROOT, rel), 'utf8'), rel).toMatch(/\bghEnv\(\)/)
    }
  })

  test('the scanner sees the forms it guards against', () => {
    const forms = [
      "execFile('git', ['status'], cb)",
      'spawnSync("git", args)',
      "await exec(\n  'git',\n  ['rev-parse'])",
      "this.deps.gh.spawn('git', ['status'], cwd)",
      "child = spawn('gh', args, {})",
      "execSync('git status --porcelain')",
      "execFileAsync('git.exe', args)",
      "import simpleGit from 'simple-git'"
    ]
    for (const form of forms) expect(findGitSpawns(form), form).toHaveLength(1)
    for (const benign of ["const CLIS = ['claude', 'gh', 'git']", "// execFile('git', ['status'])", "/** spawn('git', args) */", "new Set(['git', 'npm'])", "where.exe', ['git']"]) {
      expect(findGitSpawns(benign), benign).toEqual([])
    }
  })
})
