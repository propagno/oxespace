/**
 * The small, believable demo project that e2e/readme-shots.spec.ts captures the README images from (OXE-393): its
 * files, its git history, and the test the captured terminal runs with `node --test`. It is a helper so a unit test can
 * seed it and run that `node --test` outside Electron (tests/unit/readme-demo-project.test.ts). The demo's own test
 * files import only node:test, node:assert/strict and the demo's ../src; nothing of the spec's own helpers.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Seeds the demo repository at `repo`, replacing it; `baseEnv` is the environment its git commands start from. */
export function seedDemoRepo(repo: string, baseEnv: NodeJS.ProcessEnv = process.env): void {
  if (existsSync(repo)) rmSync(repo, { recursive: true, force: true })
  mkdirSync(join(repo, 'src', 'auth'), { recursive: true })
  mkdirSync(join(repo, 'test'), { recursive: true })
  const env = { ...baseEnv, GIT_AUTHOR_NAME: 'Ana Souza', GIT_AUTHOR_EMAIL: 'ana@example.com', GIT_COMMITTER_NAME: 'Ana Souza', GIT_COMMITTER_EMAIL: 'ana@example.com' }
  let day = 1
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo, env: { ...env, GIT_AUTHOR_DATE: `2026-10-0${day}T10:00:00Z`, GIT_COMMITTER_DATE: `2026-10-0${day}T10:00:00Z` }, stdio: 'ignore' }) }
  const commit = (message: string): void => { git('add', '.'); git('commit', '-qm', message); day++ }

  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'acme-web', version: '2.4.0', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n')
  writeFileSync(join(repo, 'README.md'), '# acme-web\n\nStorefront API and checkout.\n')
  commit('chore: project skeleton')
  writeFileSync(join(repo, 'src', 'auth', 'login.js'), LOGIN_BEFORE)
  commit('feat(auth): email and password sign-in')
  writeFileSync(join(repo, 'test', 'login.test.js'), LOGIN_TEST)
  commit('test(auth): sign-in happy path')

  git('checkout', '-qb', 'feat/login-rate-limit')
  writeFileSync(join(repo, 'src', 'auth', 'rate-limit.js'), RATE_LIMIT)
  writeFileSync(join(repo, 'src', 'auth', 'login.js'), LOGIN_AFTER)
  writeFileSync(join(repo, 'test', 'rate-limit.test.js'), RATE_LIMIT_TEST)
  commit('feat(auth): limit sign-in attempts per account and address')
}

export const LOGIN_BEFORE = `import { verifyPassword } from './password.js'
import { createSession } from './session.js'

export async function signIn(store, { email, password, ip }) {
  const user = await store.users.findByEmail(email)
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { status: 401, error: 'Wrong email or password' }
  }
  return { status: 200, session: await createSession(store, user) }
}
`

export const LOGIN_AFTER = `import { verifyPassword } from './password.js'
import { createSession } from './session.js'
import { isLimited, record } from './rate-limit.js'

export async function signIn(store, { email, password, ip }) {
  const keys = [\`account:\${email.toLowerCase()}\`, \`ip:\${ip}\`]
  const blocked = keys.map(isLimited).find(Boolean)
  if (blocked) return { status: 429, headers: { 'Retry-After': blocked.retryAfter } }
  keys.forEach(record)
  const user = await store.users.findByEmail(email)
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { status: 401, error: 'Wrong email or password' }
  }
  return { status: 200, session: await createSession(store, user) }
}
`

export const RATE_LIMIT = `const WINDOW_MS = 15 * 60 * 1000
const LIMITS = { account: 5, ip: 20 }
const attempts = new Map()

function recent(key, now) {
  const list = (attempts.get(key) ?? []).filter(at => now - at < WINDOW_MS)
  attempts.set(key, list)
  return list
}

export function record(key, now = Date.now()) {
  recent(key, now).push(now)
}

export function isLimited(key, now = Date.now()) {
  const list = recent(key, now)
  const limit = LIMITS[key.split(':')[0]]
  if (list.length < limit) return null
  return { retryAfter: Math.ceil((list[0] + WINDOW_MS - now) / 1000) }
}

export function resetForTests() {
  attempts.clear()
}
`

export const LOGIN_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'

test('signs in with the right password', () => {
  assert.equal(1 + 1, 2)
})
`

export const RATE_LIMIT_TEST = `import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { isLimited, record, resetForTests } from '../src/auth/rate-limit.js'

beforeEach(resetForTests)

test('blocks the sixth attempt for an account', () => {
  for (let i = 0; i < 5; i++) record('account:ana@example.com', 0)
  assert.ok(isLimited('account:ana@example.com', 1000))
})

test('blocks an address after 20 attempts', () => {
  for (let i = 0; i < 20; i++) record('ip:203.0.113.7', 0)
  assert.ok(isLimited('ip:203.0.113.7', 1000))
})

test('sends Retry-After in seconds', () => {
  for (let i = 0; i < 5; i++) record('account:ana@example.com', 0)
  assert.equal(isLimited('account:ana@example.com', 60_000).retryAfter, 840)
})
`
