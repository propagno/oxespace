import { _electron as electron, test } from '@playwright/test'
import { cleanEnv } from './clean-env'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * #203 (B8.3) on main, black box, REAL app in a throwaway profile: fake secrets are planted where a support bundle
 * could pick them up (environment, an old log, the workspace folder name, a git remote with a token), then the bundle
 * is exported (save dialog answered with a temp path), unzipped and searched, and the agent tool `oxespace_diagnostics`
 * is called through the internal MCP server and searched the same way. All values are fake.
 * Output: e2e/screenshots/homologation/check-203/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-203')
mkdirSync(OUT, { recursive: true })

const FAKE = {
  anthropic: 'sk-ant-api03-HMLFAKEhmlfakeHMLFAKEhmlfakeHMLFAKEhmlfake0123456789abcdef-AAAA',
  github: 'ghp_HMLFAKE0123456789abcdefghijklmnopqrstu',
  aws: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYHMLFAKEKEY',
  dbPassword: 'SenhaSuperSecretaHML42',
  dbHost: 'db-interno.hml-corp.example',
  email: 'pessoa.hml@empresa-hml.example',
  client: 'cliente-acme-confidencial',
  bearer: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJobWwifQ.HMLFAKEsignature0123'
}

test('diagnostics bundle and agent tool keep secrets and paths out', async () => {
  test.setTimeout(240_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-203-'))
  const repo = join(root, FAKE.client, 'repo'); mkdirSync(repo, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  git('init', '-q'); git('config', 'user.email', FAKE.email); git('config', 'user.name', 'HML')
  git('remote', 'add', 'origin', `https://hml:${FAKE.github}@github.com/acme/${FAKE.client}.git`)
  writeFileSync(join(repo, 'README.md'), '# x\n'); git('add', '.'); git('commit', '-qm', 'init')
  const env = {
    ...cleanEnv(), OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'pt-BR',
    ANTHROPIC_API_KEY: FAKE.anthropic, GITHUB_TOKEN: FAKE.github, AWS_SECRET_ACCESS_KEY: FAKE.aws,
    DATABASE_URL: `postgres://admin:${FAKE.dbPassword}@${FAKE.dbHost}:5432/prod`, HML_BEARER: `Bearer ${FAKE.bearer}`
  }
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env })
  const notes: Record<string, unknown> = {}
  try {
    const page = await app.firstWindow()
    // No native dialog may reach the person's screen: any message box is recorded and answered "deny" (0).
    await app.evaluate(({ dialog }) => {
      const g = globalThis as Record<string, unknown>; g.boxes = []
      dialog.showMessageBox = (async (...args: unknown[]) => { (g.boxes as unknown[]).push(args.length > 1 ? args[1] : args[0]); return { response: 0, checkboxChecked: false } }) as typeof dialog.showMessageBox
    })
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    // Seed an older log only if the log folder is inside this throwaway profile.
    const logs = await app.evaluate(({ app }) => app.getPath('logs'))
    notes.logsFolder = logs.startsWith(root) ? 'inside the test profile' : `OUTSIDE (${logs}), not seeded`
    if (logs.startsWith(root)) {
      mkdirSync(logs, { recursive: true })
      appendFileSync(join(logs, 'main.old.log'), [
        `[2026-10-30 10:00:00.000] [info]  [oxepost] request failed https://admin:${FAKE.dbPassword}@${FAKE.dbHost}/v1?token=${FAKE.github}`,
        `[2026-10-30 10:00:01.000] [warn]  [agent] env ANTHROPIC_API_KEY=${FAKE.anthropic} AWS=${FAKE.aws}`,
        `[2026-10-30 10:00:02.000] [error]  [git] push to ${repo} as ${FAKE.email} failed`,
        `[2026-10-30 10:00:03.000] [info]  [http] Authorization Bearer ${FAKE.bearer}`,
        `[2026-10-30 10:00:04.000] [info]  [thread] user said the password is ${FAKE.dbPassword} for ${FAKE.client}`,
        `[2026-10-30 10:00:05.000] [info]  [fs] opened \\\\${FAKE.dbHost}\\share\\${FAKE.client}\\plan.xlsx`,
        `[2026-10-30 10:00:06.000] [info]  [net] connected to 10.20.30.40:5432 and fe80::1 from ${hostname()} as ${userInfo().username}`,
        ''
      ].join('\n'))
    }
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForTimeout(3_000)
    // An incident whose raw text carries a secret: a workspace root that does not exist, named with a token.
    await page.evaluate(async fake => {
      const oxe = (window as unknown as { oxe: { workspace: { create: (i: object) => Promise<unknown> } } }).oxe
      await oxe.workspace.create({ rootPath: `C:\\${fake.github}\\${fake.client}`, autoStart: false }).catch(() => undefined)
      await oxe.workspace.create({ rootPath: 42 as unknown as string }).catch(() => undefined)
    }, FAKE)

    const oxe = 'window.oxe.diagnostics'
    notes.preview = await page.evaluate(`${oxe}.previewBundle()`)
    const zip = join(root, 'bundle-export.zip')
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog }, zip)
    notes.exported = await page.evaluate(`${oxe}.exportBundle()`)
    notes.summaryIpc = await page.evaluate(`${oxe}.analysisSummary()`)
    const extracted = join(root, 'bundle'); mkdirSync(extracted)
    execFileSync(String.raw`C:\Windows\System32\tar.exe`, ['-xf', zip, '-C', extracted])
    const files = Object.fromEntries(readdirSync(extracted).map(name => [name, readFileSync(join(extracted, name), 'utf8')]))

    // The agent tool through the internal MCP server, as an agent would call it.
    const db = new DatabaseSync(join(root, 'oxespace.sqlite3'))
    const meta = db.prepare('SELECT port, token FROM internal_mcp_meta LIMIT 1').get() as { port: number; token: string }
    const workspace = (db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
    db.close()
    const res = await fetch(`http://127.0.0.1:${meta.port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${meta.token}`, 'X-OXE-Workspace-Id': workspace }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'oxespace_diagnostics', arguments: {} } }) })
    const tool = JSON.stringify(await res.json())
    files['(tool) oxespace_diagnostics'] = tool
    files['(ipc) analysisSummary'] = String(notes.summaryIpc)

    const needles: Record<string, string> = {
      ...FAKE, githubShort: 'ghp_HMLFAKE', anthropicShort: 'sk-ant-api03', userName: userInfo().username, machine: hostname(),
      usersFolder: 'C:\\Users', usersFolderJson: 'C:\\\\Users', tempRoot: root.split('\\').pop() ?? root, ipv4: '10.20.30.40', ipv6: 'fe80::1', at: '@'
    }
    const leaks: Record<string, string[]> = {}
    for (const [name, text] of Object.entries(files)) {
      for (const [label, needle] of Object.entries(needles)) {
        let i = text.indexOf(needle)
        while (i >= 0) { (leaks[name] ??= []).push(`${label}: …${text.slice(Math.max(0, i - 50), i + needle.length + 30).replace(/\s+/g, ' ')}…`); i = text.indexOf(needle, i + needle.length) }
      }
    }
    notes.files = Object.fromEntries(Object.entries(files).map(([n, t]) => [n, t.length]))
    notes.leaks = leaks
    notes.logTail = files['main-log-tail.txt']?.split('\n').slice(-20)
    notes.toolText = tool.slice(0, 1500)
    for (const [name, text] of Object.entries(files)) writeFileSync(join(OUT, name.replace(/[^\w.-]+/g, '_')), text)
    console.log('C203', JSON.stringify({ logs: notes.logsFolder, files: notes.files, redactions: (notes.preview as { redactions?: number })?.redactions, leakCount: Object.values(leaks).flat().length }))
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
