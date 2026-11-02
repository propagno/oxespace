import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * #252 (B8.3 follow-up) on #203's bundle, REAL app, black box. Fake secrets are planted where a support bundle could pick
 * them up: the environment, an old log, the folder name, and a git remote with a token. The bundle is then exported
 * (the save dialog is answered with a temp path), unzipped and searched.
 * - 0 leaks, as before;
 * - versions.json keeps every version intact (no "[ip]" from a four-part V8 version);
 * - the app's own version, not Electron's.
 */
const FAKE = {
  anthropic: 'sk-ant-api03-HMLFAKEhmlfakeHMLFAKEhmlfakeHMLFAKEhmlfake0123456789abcdef-AAAA',
  github: 'ghp_HMLFAKE0123456789abcdefghijklmnopqrstu',
  aws: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYHMLFAKEKEY',
  dbPassword: 'SenhaSuperSecretaHML42',
  dbHost: 'db-interno.hml-corp.example',
  email: 'pessoa.hml@empresa-hml.example',
  client: 'cliente-acme-confidencial'
}

test('#252: the diagnostics bundle keeps versions intact and secrets out', async () => {
  test.setTimeout(180_000)
  const base = realProfile('diag252')
  const repo = join(base.root, FAKE.client, 'repo'); mkdirSync(repo, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  git('init', '-q'); git('config', 'user.email', FAKE.email); git('config', 'user.name', 'HML')
  git('remote', 'add', 'origin', `https://hml:${FAKE.github}@github.com/acme/${FAKE.client}.git`)
  writeFileSync(join(repo, 'README.md'), '# x\n'); git('add', '.'); git('commit', '-qm', 'init')
  const env = { ...base.env, OXESPACE_LOCALE: 'en-US', ANTHROPIC_API_KEY: FAKE.anthropic, GITHUB_TOKEN: FAKE.github, AWS_SECRET_ACCESS_KEY: FAKE.aws,
    DATABASE_URL: `postgres://admin:${FAKE.dbPassword}@${FAKE.dbHost}:5432/prod` }
  const { app, page } = await launchReal({ ...base, env })
  const out: Record<string, unknown> = {}
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    const logs = await app.evaluate(({ app }) => app.getPath('logs'))
    if (logs.startsWith(base.root)) {
      mkdirSync(logs, { recursive: true })
      appendFileSync(join(logs, 'main.old.log'), [
        `[2026-10-30 10:00:00.000] [info]  [oxepost] request failed https://admin:${FAKE.dbPassword}@${FAKE.dbHost}/v1?token=${FAKE.github}`,
        `[2026-10-30 10:00:01.000] [warn]  [agent] env ANTHROPIC_API_KEY=${FAKE.anthropic} AWS=${FAKE.aws}`,
        `[2026-10-30 10:00:02.000] [error]  [git] push to ${repo} as ${FAKE.email} failed`,
        `[2026-10-30 10:00:06.000] [info]  [net] connected to 10.20.30.40:5432 from ${hostname()} as ${userInfo().username}`, ''
      ].join('\n'))
    }
    await openRepo(page, repo)
    const zip = join(base.root, 'bundle-export.zip')
    await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog }, zip)
    out.exported = await page.evaluate('window.oxe.diagnostics.exportBundle()')
    const extracted = join(base.root, 'bundle'); mkdirSync(extracted)
    execFileSync(process.platform === 'win32' ? String.raw`C:\Windows\System32\tar.exe` : 'tar', ['-xf', zip, '-C', extracted])
    const files: Record<string, string> = Object.fromEntries(readdirSync(extracted).map(name => [name, readFileSync(join(extracted, name), 'utf8')]))
    files['(ipc) analysisSummary'] = String(await page.evaluate('window.oxe.diagnostics.analysisSummary()'))
    const pkgVersion = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version
    const versions = files['versions.json'] ?? ''
    out.versions = versions.slice(0, 600)
    expect.soft(versions, 'versions.json exists').not.toBe('')
    expect.soft(versions, 'no version redacted as an IP').not.toContain('[ip]')
    expect.soft(versions, `the app's own version (${pkgVersion})`).toContain(pkgVersion)
    expect.soft(versions, "not Electron's version as the app's").not.toMatch(/"(app|version|appVersion)"\s*:\s*"44\./)

    const needles: Record<string, string> = { ...FAKE, githubShort: 'ghp_HMLFAKE', anthropicShort: 'sk-ant-api03', userName: userInfo().username, machine: hostname(), ipv4: '10.20.30.40' }
    const leaks: string[] = []
    for (const [name, text] of Object.entries(files)) for (const [label, needle] of Object.entries(needles)) {
      if (needle.length >= 4 && text.includes(needle)) leaks.push(`${name}: ${label}`)
    }
    out.files = Object.fromEntries(Object.entries(files).map(([n, t]) => [n, t.length]))
    out.leaks = leaks
    expect.soft(leaks, 'no planted secret, user name, machine name or IP in the bundle').toEqual([])
  } finally {
    console.log('DIAG252', JSON.stringify(out).slice(0, 3000))
    await quitReal(app)
  }
})
