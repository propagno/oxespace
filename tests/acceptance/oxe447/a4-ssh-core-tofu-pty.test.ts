import { createHash } from 'node:crypto'
import { Server as SshServer, utils, type ServerChannel } from 'ssh2'
import { afterEach, describe, expect, it } from 'vitest'
import { LATEST_DB_VERSION, openInMemoryDatabase } from '../../../electron/main/db/index'
import { createSecretCipher, type SafeStorageLike } from '../../../electron/main/services/oxequery/secret-cipher'
import { RemoteSshHostsService } from '../../../electron/main/services/ssh/remote-ssh-hosts.service'
import {
  connectSshClient,
  fingerprintOf,
  probeSshHostKey
} from '../../../electron/main/services/ssh/ssh-client.service'
import { parseSshConfig } from '../../../electron/main/services/ssh/ssh-config-parser'
import { createSshHostedPty } from '../../../electron/main/services/ssh/ssh-hosted-pty'

function freshKeyPair(): { private: string; public: string } {
  for (let attempt = 0; attempt < 10; attempt++) {
    const pair = utils.generateKeyPairSync('ed25519')
    const parsed = utils.parseKey(pair.private)
    if (!(parsed instanceof Error)) return pair
  }
  throw new Error('Could not generate parseable ed25519 key')
}

function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (v: string) => Buffer.from(`enc:${Buffer.from(v, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (b: Buffer) => Buffer.from(b.toString('utf8').slice(4), 'base64').toString('utf8')
  }
}

describe('OXE-447 A4 — Shared SSH core, mandatory TOFU pinning, ~/.ssh/config import, and SshHostedPty', () => {
  const cleanup: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn()
  })

  async function startShellSshServer(password: string) {
    const hostKey = freshKeyPair().private
    const resizes: Array<{ cols: number; rows: number }> = []
    const activeChannels = new Set<ServerChannel>()
    const activeClients = new Set<{ end: () => void }>()

    const server = new SshServer({ hostKeys: [hostKey] }, client => {
      activeClients.add(client)
      client.on('close', () => activeClients.delete(client))
      client.on('authentication', ctx => {
        if (ctx.method === 'password' && ctx.password === password) return ctx.accept()
        ctx.reject()
      })
      client.on('ready', () => {
        client.on('session', accept => {
          const session = accept()
          session.on('pty', (acceptPty, _rejectPty, info) => {
            resizes.push({ cols: info.cols, rows: info.rows })
            acceptPty?.()
          })
          session.on('window-change', (acceptChange, _rejectChange, info) => {
            resizes.push({ cols: info.cols, rows: info.rows })
            acceptChange?.()
          })
          session.on('shell', acceptShell => {
            const channel = acceptShell()
            activeChannels.add(channel)
            channel.on('close', () => activeChannels.delete(channel))
            channel.write('SSH_READY\r\n')
            channel.on('data', (chunk: Buffer) => {
              channel.write(`ECHO:${chunk.toString('utf8')}`)
            })
          })
        })
      })
      client.on('error', () => undefined)
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>(resolve => {
      for (const ch of activeChannels) ch.close()
      for (const c of activeClients) c.end()
      server.close(() => resolve())
    }))

    const parsed = utils.parseKey(hostKey)
    const key = Array.isArray(parsed) ? parsed[0] : parsed
    if (key instanceof Error) throw key
    const fingerprint = `SHA256:${createHash('sha256').update(key.getPublicSSH()).digest('base64').replace(/=+$/, '')}`

    return {
      port: (server.address() as { port: number }).port,
      fingerprint,
      resizes,
      dropConnections: () => {
        for (const ch of activeChannels) ch.close()
        for (const c of activeClients) c.end()
      }
    }
  }

  it('enforces mandatory SHA-256 TOFU pinning before auth (unknown and changed host keys refused)', async () => {
    const server = await startShellSshServer('s3cr3t!')

    // Unknown host key refused before auth with presented fingerprint.
    await expect(connectSshClient({
      host: '127.0.0.1',
      port: server.port,
      username: 'dev',
      authType: 'password',
      password: 's3cr3t!'
    })).rejects.toMatchObject({
      code: 'host-key-unknown',
      reasons: [server.fingerprint]
    })

    // Probing returns exact SHA-256 fingerprint.
    const probed = await probeSshHostKey({ host: '127.0.0.1', port: server.port })
    expect(probed).toBe(server.fingerprint)

    // Changed host key refused with [pinned, presented].
    const different = fingerprintOf(createHash('sha256').update('other-server-key').digest('hex'))
    await expect(connectSshClient({
      host: '127.0.0.1',
      port: server.port,
      username: 'dev',
      authType: 'password',
      password: 's3cr3t!',
      pinnedFingerprint: different
    })).rejects.toMatchObject({
      code: 'host-key-changed',
      reasons: [different, server.fingerprint]
    })
  })

  it('migrates remote_ssh_hosts (v109+), encrypts secrets via safeStorage, imports ~/.ssh/config, and runs SshHostedPty', async () => {
    const server = await startShellSshServer('ssh-pass-42')
    const db = openInMemoryDatabase()
    cleanup.push(() => db.close())
    expect(LATEST_DB_VERSION).toBeGreaterThanOrEqual(109)

    // When safeStorage is unavailable, saving a secret must fail (never plaintext).
    const brokenCipher = createSecretCipher(fakeSafeStorage(false), 'win32', {})
    const brokenService = new RemoteSshHostsService(db, brokenCipher)
    expect(() => brokenService.create({
      name: 'Unsafe',
      host: '127.0.0.1',
      port: server.port,
      username: 'dev',
      authType: 'password',
      secret: 'plain-must-fail'
    })).toThrow()

    // With safeStorage available, secret is encrypted at rest and never exposed in list/get.
    const cipher = createSecretCipher(fakeSafeStorage(true), 'win32', {})
    const service = new RemoteSshHostsService(db, cipher)
    const created = service.create({
      name: 'Build Box',
      host: '127.0.0.1',
      port: server.port,
      username: 'dev',
      authType: 'password',
      secret: 'ssh-pass-42',
      defaultRemoteDir: '/srv/app'
    })
    expect(created.hasSecret).toBe(true)
    expect(JSON.stringify(created)).not.toContain('ssh-pass-42')

    const rawRow = db.prepare('SELECT encrypted_secret FROM remote_ssh_hosts WHERE id = ?').get(created.id) as { encrypted_secret: Buffer | null }
    expect(rawRow.encrypted_secret).not.toBeNull()
    expect(rawRow.encrypted_secret!.toString('utf8')).not.toContain('ssh-pass-42')

    // Pin fingerprint and verify SshHostedPty over IPty contract (UTF-8, resize, disconnect + reconnect).
    const probed = await service.probeHostKey({ host: '127.0.0.1', port: server.port })
    expect(probed).toBe(server.fingerprint)
    service.pinFingerprint(created.id, probed)

    const resolved = service.resolveConnectionConfig(created.id)
    const pty = await createSshHostedPty({ config: resolved, cols: 90, rows: 30 })
    cleanup.push(() => pty.kill())

    const received: string[] = []
    pty.onData(chunk => received.push(chunk))
    const states: string[] = []
    pty.onState(state => states.push(state))

    pty.write('olá 🚀 remoto\n')
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(received.join('')).toContain('ECHO:olá 🚀 remoto')

    pty.resize(132, 42)
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(pty.cols).toBe(132)
    expect(pty.rows).toBe(42)
    expect(server.resizes).toContainEqual({ cols: 132, rows: 42 })

    // Abrupt disconnect -> disconnected state -> explicit reconnect restores live shell.
    server.dropConnections()
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(pty.state).toBe('disconnected')
    expect(states).toContain('disconnected')

    await pty.reconnect()
    expect(pty.state).toBe('connected')
    pty.write('after-reconnect\n')
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(received.join('')).toContain('ECHO:after-reconnect')

    // ~/.ssh/config parser & idempotent import (preserves pinned fingerprint on re-import).
    const sampleConfig = [
      '# Ignore global wildcard',
      'Host *',
      '  ServerAliveInterval 60',
      '',
      'Host prod-api',
      '  HostName 10.0.0.20',
      '  User deploy',
      '  Port 2222',
      '  IdentityFile ~/.ssh/id_ed25519',
      '',
      'Host staging',
      '  HostName 10.0.0.21',
      '  User ubuntu'
    ].join('\n')

    const parsed = parseSshConfig(sampleConfig, '/home/tester')
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      name: 'prod-api',
      host: '10.0.0.20',
      port: 2222,
      username: 'deploy',
      authType: 'key',
      keyPath: '/home/tester/.ssh/id_ed25519'
    })
    expect(parsed[1]).toMatchObject({
      name: 'staging',
      host: '10.0.0.21',
      port: 22,
      username: 'ubuntu',
      authType: 'agent'
    })

    const imp1 = service.importFromSshConfig(sampleConfig, '/home/tester')
    expect(imp1.imported).toHaveLength(2)
    service.pinFingerprint(imp1.imported[0].id, server.fingerprint)

    const imp2 = service.importFromSshConfig(sampleConfig, '/home/tester')
    expect(imp2.imported).toHaveLength(0)
    expect(imp2.skipped).toBe(2)
    expect(service.get(imp1.imported[0].id)?.pinnedFingerprint).toBe(server.fingerprint)
  })
})
