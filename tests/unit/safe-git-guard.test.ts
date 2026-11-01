// @vitest-environment node
/**
 * Every git the main process runs goes through electron/main/utils/safe-git.ts (local) or safe-git-person.ts (the
 * person's network git): a repository an agent can write names commands git would otherwise run, with no click
 * (SECURITY S4-1). This scans electron/main for any other way to start git or gh and fails on one that is not on an
 * allowlist below, where each entry says why it may.
 *
 * Two rules. Calls: a call whose first argument is `git`/`gh` (with or without more arguments, `as string` included),
 * a shell string starting with git or gh in any call (`execAsync('git status')`), a wrapper (`cmd /c git`,
 * `-Command git`, `sh -c git`), or a git library. Literals: a file that imports child_process may not hold the string
 * `git` or `gh` at all (that is how a command in a variable starts), unless LITERAL_ALLOWLIST says why.
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

/** file -> why it may start git or gh itself (the call rule). Each entry needs a reason a reviewer can check. */
const ALLOWLIST: Record<string, string> = {
  'electron/main/e2e/mock-ipc.ts': 'E2E mock IPC, loaded only by OXESPACE_E2E mock launches (tests/unit/main-entry-imports.test.ts); its git lists branches and worktrees of the fixture repo the test made.',
  'electron/main/services/copilotCredits.service.ts': 'gh only, with ghEnv() from safe-git (no GIT_* of main, no hooks, no fsmonitor, no ext::); runs `gh api` with no repository as cwd.',
  'electron/main/services/github/gh-exec.ts': "gh only: `gh --version` through GhExec.spawn, which gives every command ghEnv() and refuses git; GhExec's git goes through prepareGit / preparePersonGit."
}

/** file -> why it may hold a `git`/`gh` string next to child_process (the literal rule). */
const LITERAL_ALLOWLIST: Record<string, string> = {
  ...ALLOWLIST,
  'electron/main/services/git.service.ts': "`where.exe git` locates the executable (where.exe is the command, git its argument); the git it finds runs through prepareGit / runGit."
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

const Q = String.raw`['"\x60]`
const GIT_OR_GH = String.raw`${Q}(?:git|gh)(?:\.(?:exe|cmd|com|bat))?${Q}(?:\s+as\s+\w+)?`
/** A call whose first argument is the literal git or gh: spawn('git', …), spawn('git'), exec('gh' as string, …). */
const LITERAL_CALL = new RegExp(String.raw`\b[\w$.]+\s*\(\s*${GIT_OR_GH}\s*[,)]`, 'g')
/** A shell string that starts with git or gh, in any call: exec('git status'), execAsync(`gh pr list`). */
const SHELL_STRING = new RegExp(String.raw`\b[\w$.]+\s*\(\s*${Q}(?:git|gh)(?:\.exe)?\s`, 'g')
/** A wrapper that hands git or gh to a shell: ['/c', 'git', …], '-Command', 'git', 'cmd /c git …'. */
const WRAPPER = new RegExp(String.raw`${Q}(?:/c|/C|-c|-Command|/k)${Q}\s*,\s*${Q}(?:git|gh)\b|${Q}(?:cmd(?:\.exe)?\s+/[ck]|powershell(?:\.exe)?\s+-Command|sh\s+-c)\s+(?:git|gh)\b`, 'g')
/** Libraries that run git with their own environment. */
const LIBRARIES = /from\s+['"](?:simple-git|isomorphic-git|nodegit|dugite|execa)['"]|require\(\s*['"](?:simple-git|isomorphic-git|nodegit|dugite)['"]\s*\)/g
/** The string git or gh on its own: how a command in a variable starts. */
const BARE_LITERAL = new RegExp(String.raw`${Q}(?:git|gh)(?:\.(?:exe|cmd|com|bat))?${Q}`, 'g')
const IMPORTS_CHILD_PROCESS = /from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\)/

const NOT_A_PROCESS = /^(?:new\s+Set|includes|has|push|join|resolve|mainMessage|t|startsWith|endsWith|test|indexOf|equal|basename|Symbol\.for)\s*\(/

function lineOf(text: string, index: number): number { return text.slice(0, index).split('\n').length }

function findGitSpawns(source: string): string[] {
  const text = withoutComments(source)
  const found: string[] = []
  for (const re of [LITERAL_CALL, SHELL_STRING, WRAPPER, LIBRARIES]) {
    for (const match of text.matchAll(re)) {
      if (NOT_A_PROCESS.test(match[0])) continue
      found.push(`${lineOf(text, match.index)}: ${match[0].replace(/\s+/g, ' ')}`)
    }
  }
  return found
}

function findLiterals(source: string): string[] {
  const text = withoutComments(source)
  if (!IMPORTS_CHILD_PROCESS.test(text)) return []
  return [...text.matchAll(BARE_LITERAL)].map(match => `${lineOf(text, match.index)}: ${match[0]} next to child_process`)
}

describe('main-process git goes through safe-git', () => {
  const files = sources(MAIN).map(file => ({ rel: relative(ROOT, file).replace(/\\/g, '/'), text: readFileSync(file, 'utf8') }))

  test('no file outside the safe modules and the allowlist starts git or gh', () => {
    const offenders = files.filter(file => !SAFE_MODULES.has(file.rel) && !(file.rel in ALLOWLIST)).flatMap(file => findGitSpawns(file.text).map(hit => `${file.rel}:${hit}`))
    expect(offenders, 'route these through electron/main/utils/safe-git.ts (or add an allowlist entry with a reason)').toEqual([])
  })

  test('no file that imports child_process names git or gh, outside the safe modules and the allowlist', () => {
    const offenders = files.filter(file => !SAFE_MODULES.has(file.rel) && !(file.rel in LITERAL_ALLOWLIST)).flatMap(file => findLiterals(file.text).map(hit => `${file.rel}:${hit}`))
    expect(offenders, 'a git or gh command in a variable still has to go through safe-git').toEqual([])
  })

  test('every allowlist entry exists, still needs its place and says why', () => {
    for (const [rel, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, rel).toBeGreaterThan(40)
      expect(findGitSpawns(readFileSync(join(ROOT, rel), 'utf8')), `${rel} no longer starts git or gh; drop it from the allowlist`).not.toEqual([])
    }
    for (const [rel, reason] of Object.entries(LITERAL_ALLOWLIST)) {
      expect(reason.length, rel).toBeGreaterThan(40)
      expect(findLiterals(readFileSync(join(ROOT, rel), 'utf8')), `${rel} no longer names git or gh; drop it from the literal allowlist`).not.toEqual([])
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
      "spawn('git')",
      "spawn('git' as string, args)",
      "spawn('git.cmd', args)",
      "await execAsync('git status')",
      "spawn('cmd', ['/c', 'git', 'status'])",
      "spawn('powershell', ['-Command', 'git status'])",
      "exec('cmd /c git status')",
      "import simpleGit from 'simple-git'"
    ]
    for (const form of forms) expect(findGitSpawns(form), form).not.toEqual([])
    for (const benign of ["const CLIS = ['claude', 'gh', 'git']", "// execFile('git', ['status'])", "/** spawn('git', args) */", "new Set(['git', 'npm'])", "where.exe', ['git']", "t('git.control.fetch')"]) {
      expect(findGitSpawns(benign), benign).toEqual([])
    }
    // A command in a variable: caught by the literal rule wherever child_process is imported.
    expect(findLiterals("import { spawn } from 'node:child_process'\nconst g = 'git'\nspawn(g, ['status'])")).toHaveLength(1)
    expect(findLiterals("const CLIS = ['claude', 'gh', 'git']")).toEqual([])
  })
})
