import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The REAL app on a throwaway profile, for acceptance specs: no e2e doubles, a temp database, and agent config folders
 * that hold no account (CLAUDE_CONFIG_DIR, CODEX_HOME), so nothing can run on a person's paid accounts.
 */
export interface RealProfile { root: string; repo: string; db: string; env: Record<string, string> }

export function realProfile(prefix: string, extraEnv: Record<string, string> = {}): RealProfile {
  const root = mkdtempSync(join(tmpdir(), `oxe-acc-${prefix}-`))
  const repo = join(root, 'repo'); mkdirSync(repo)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['-c', 'user.email=acc@example.invalid', '-c', 'user.name=acc', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo })
  const db = join(root, 'oxespace.sqlite3')
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: db,
    CLAUDE_CONFIG_DIR: join(root, 'claude-config'), CODEX_HOME: join(root, 'codex-home'), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '',
    ...extraEnv
  }
  return { root, repo, db, env }
}

export async function launchReal(profile: RealProfile): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: profile.env })
  const page = await app.firstWindow()
  await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
  return { app, page }
}

export const quitReal = (app: ElectronApplication): Promise<unknown> => app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)

/** Opens the repo as a one-pane workspace through the wizard, as a person would. */
export async function openRepo(page: Page, repo: string): Promise<void> {
  await page.getByTestId('btn-new-workspace').first().click()
  await page.getByTestId('wizard-dir-input').fill(repo)
  await page.getByTestId('wizard-layout-card-1').click().catch(() => undefined)
  await page.getByTestId('wizard-launch-btn').click()
  await page.waitForTimeout(2_500)
}

export const mode = (page: Page, id: 'code' | 'thread' | 'data' | 'pods' | 'post') => page.locator(`button[data-app-mode="${id}"]`).first().click()
