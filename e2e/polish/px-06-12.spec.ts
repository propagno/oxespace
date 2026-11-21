// Frozen end-to-end acceptance test for 1.5.2 Polimento 2 (Jira OXE-271, PX-06·12, CA-4; A16), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. In pt-BR and the compact
// density, the person opens a conversation of the stand-in Claude (no paid account, no turn sent) and chooses
// Mais ações › Delegar…: the delegation dialog has no English text and its fields are 32 px tall (--control-lg in
// compact). Red on main f65fa5374: min-height 36px (DelegationCreateDialog.css).
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

const read = (rel: string): Record<string, unknown> => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8'))
function text(lang: string, ns: string, key: string): string {
  let node: unknown = read(`shared/locales/${lang}/${ns}.json`)
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the ${lang} ${ns} catalog has no key ${key}`)
  return node
}
const pt = (ns: string, key: string): string => text('pt-BR', ns, key)
/** The English strings of a catalog subtree that pt-BR says differently: none of them may show in pt-BR. */
function englishOnly(ns: string, subtree: string): string[] {
  const en = read(`shared/locales/en/${ns}.json`)[subtree] as Record<string, unknown>
  const out: string[] = []
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') { const plain = node.replace(/\{\{\w+\}\}/g, '').trim(); if (plain.length > 5 && plain !== pt(ns, path)) out.push(plain) }
    else if (node && typeof node === 'object') for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`)
  }
  walk(en, subtree)
  return out
}

// A stand-in `claude` (the same script family as e2e/polish/ag09-activity-bell.spec.ts): it answers --version and auth
// status, so a conversation can be created; this test sends no turn. Linux only (a script is refused on Windows).
const STAND_IN = String.raw`#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === '--version' || args[0] === '-v') { process.stdout.write('2.1.0 (Claude Code)\n'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'status') { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'stand-in' })); process.exit(0) }
process.stdin.on('data', () => undefined)
process.stdin.on('end', () => process.exit(0))
`
function standInEnv(prefix: string): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), `oxe-${prefix}-`))
  const bin = join(root, 'bin'); mkdirSync(bin, { recursive: true })
  const script = join(bin, 'claude'); writeFileSync(script, STAND_IN); chmodSync(script, 0o755)
  return { OXESPACE_E2E_MOCK_NATIVE: '0', PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, CLAUDE_CONFIG_DIR: join(root, 'claude-config'), CODEX_HOME: join(root, 'codex-home'), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }
}
function gitRepo(root: string): string {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=e2e@example.invalid', '-c', 'user.name=e2e', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root })
  return realpathSync.native(root)
}
const oxe = <T>(page: Page, path: string, ...args: unknown[]) => page.evaluate(([p, a]) => {
  const [group, fn] = (p as string).split('.')
  const api = (window as unknown as { oxe: Record<string, Record<string, (...x: unknown[]) => Promise<unknown>>> }).oxe
  return api[group][fn](...(a as unknown[]))
}, [path, args] as const) as Promise<T>

test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('PX-06·12 in the app: in pt-BR delegation dialog renders translated copy and 32 px inputs in compact density', async () => {
  test.setTimeout(240_000)
  const { app, page, workspaceRoot } = await launchApp({ locale: 'pt-BR', density: 'compact', appearance: 'light', realClock: true, env: { ...standInEnv('px0612'), OXESPACE_LOCALE: 'pt-BR' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    const root = gitRepo(workspaceRoot)
    await openDemoWorkspace(page, root)
    const project = await oxe<{ projectId: string }>(page, 'thread.addProject', root)
    const created = await oxe<{ thread: { id: string } }>(page, 'thread.create', { projectId: project.projectId, rootPath: root, provider: 'claude' })
    await page.locator('button[data-app-mode="thread"]').first().click()
    const row = page.locator(`[data-thread-row="${created.thread.id}"] [data-list-item]`).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.click()

    await page.getByRole('button', { name: pt('thread', 'header.moreActions'), exact: true }).first().click()
    await page.getByRole('menuitem', { name: pt('thread', 'moreActions.delegate') }).click()
    const dialog = page.getByRole('dialog', { name: pt('code', 'delegate.title') })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    const fields = dialog.locator('input:not([type=checkbox]):not([type=radio]), select')
    await expect(fields.first()).toBeVisible()
    const heights = await fields.evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).offsetParent !== null).map(node => node.getBoundingClientRect().height))
    expect(heights.length).toBeGreaterThan(0)
    // Sub-pixel layout rounding allowed; the token itself is pinned by tests/oxe152/polish/px06-delegation.test.tsx.
    for (const height of heights) expect(Math.abs(height - 32), `a field is ${height}px, not 32px`).toBeLessThanOrEqual(0.5)
    const shown = await dialog.innerText()
    for (const english of englishOnly('code', 'delegate')) expect(shown, `no English "${english}"`).not.toContain(english)
    await page.screenshot({ path: test.info().outputPath('px-06-12.png') })
  } finally {
    await app.close()
  }
})
