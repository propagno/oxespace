import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { connect as tlsConnect } from 'node:tls'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * M1 (S4) · The desktop gateway, off by default.
 * Roadmap acceptance: off → no port open; on → TLS only; internal tokens (MCP, execution) never pass through it.
 *
 * REAL app. The "on" half turns the gateway on, which makes Windows show the Defender Firewall prompt on the screen
 * of whoever runs it: it only runs with OXESPACE_ACCEPT_FIREWALL=1 (CI runners, or a person at the machine).
 */
function listening(pids: number[]): Array<{ address: string; port: number }> {
  if (process.platform === 'win32') {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -State Listen | Where-Object { @(${pids.join(',')}) -contains $_.OwningProcess } | ForEach-Object { "$($_.LocalAddress) $($_.LocalPort)" }`], { encoding: 'utf8' })
    return out.split(/\r?\n/).filter(Boolean).map(l => { const [address, port] = l.trim().split(' '); return { address, port: Number(port) } })
  }
  const out = execFileSync('ss', ['-ltnpH'], { encoding: 'utf8' })
  return out.split('\n').filter(l => pids.some(p => l.includes(`pid=${p},`))).map(l => { const local = l.trim().split(/\s+/)[3]; const i = local.lastIndexOf(':'); return { address: local.slice(0, i), port: Number(local.slice(i + 1)) } })
}
const appPids = (app: ElectronApplication) => app.evaluate(({ app }) => app.getAppMetrics().map(m => m.pid))
const isLoopback = (a: string) => /^(127\.|::1$|\[::1\]|localhost)/.test(a)

test('M1: with the gateway off, nothing listens beyond loopback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-acc-m1-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3') } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    await page.waitForTimeout(2_000)
    const sockets = listening(await appPids(app))
    expect(sockets.filter(s => !isLoopback(s.address)), 'no LAN or wildcard listener with the gateway off').toEqual([])
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined) }
})

test('M1: with the gateway on, only TLS on private addresses, and the MCP token does not open it', async () => {
  test.skip(process.env.OXESPACE_ACCEPT_FIREWALL !== '1', 'turning the gateway on shows the OS firewall prompt; set OXESPACE_ACCEPT_FIREWALL=1 where that is expected')
  const root = mkdtempSync(join(tmpdir(), 'oxe-acc-m1b-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3') } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    await page.evaluate(() => (window as unknown as { oxe: { remote: { setEnabled: (i: { enabled: boolean }) => Promise<unknown> } } }).oxe.remote.setEnabled({ enabled: true }))
    await page.waitForTimeout(2_000)
    const sockets = listening(await appPids(app)).filter(s => !isLoopback(s.address))
    expect(sockets.length, 'the gateway listens').toBeGreaterThan(0)
    for (const s of sockets) expect(s.address, 'private addresses only, never the wildcard').toMatch(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fd|fe80)/i)
    const { address, port } = sockets[0]
    // Plain HTTP is not answered as HTTP.
    const plain = await new Promise<string>(resolve => { const r = request({ host: address, port, path: '/', timeout: 3_000 }, res => resolve(`http ${res.statusCode}`)); r.on('error', e => resolve(`error ${e.message}`)); r.on('timeout', () => { r.destroy(); resolve('timeout') }); r.end() })
    expect(plain, 'no plain HTTP on the gateway').not.toMatch(/^http /)
    // TLS answers (the certificate is the pinned self-signed one, so it is not verified here).
    const tls = await new Promise<string>(resolve => { const sock = tlsConnect({ host: address, port, rejectUnauthorized: false, timeout: 3_000 }, () => { resolve(`tls ${sock.getProtocol()}`); sock.end() }); sock.on('error', e => resolve(`error ${e.message}`)) })
    expect(tls).toMatch(/^tls TLSv1\.[23]/)
    // The internal MCP token is not a gateway credential.
    const db = new DatabaseSync(join(root, 'oxespace.sqlite3')); const meta = db.prepare('SELECT token FROM internal_mcp_meta LIMIT 1').get() as { token: string }; db.close()
    const withMcpToken = await new Promise<string>(resolve => {
      const sock = tlsConnect({ host: address, port, rejectUnauthorized: false, timeout: 3_000 }, () => { sock.write(`POST /rpc HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${meta.token}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}`) })
      let data = ''; sock.on('data', d => { data += d.toString() }); sock.on('end', () => resolve(data.split('\r\n')[0] ?? '')); sock.on('error', e => resolve(`error ${e.message}`)); setTimeout(() => { sock.destroy(); resolve(data.split('\r\n')[0] || 'no answer') }, 3_000)
    })
    expect(withMcpToken, 'the MCP token is refused by the gateway').not.toMatch(/ 200 /)
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined) }
})
