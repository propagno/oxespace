import { createHash } from 'node:crypto'
import { createServer as createTcpServer, connect as connectTcp, type Server as TcpServer } from 'node:net'
import { Server as SshServer, utils, type ServerChannel } from 'ssh2'
import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { AgentStateService } from '../../../electron/main/services/agent-state/agent-state.service'
import { BUNDLED_MANIFESTS } from '../../../electron/main/services/agent-state/bundled-manifests'
import { openTunnel } from '../../../electron/main/services/oxequery/ssh-tunnel'
import { createSshHostedPty, type SshHostedPty } from '../../../electron/main/services/ssh/ssh-hosted-pty'
import { TerminalManager } from '../../../electron/main/services/terminal.service'

function freshKeyPair(): { private: string; public: string } {
  for (let attempt = 0; attempt < 10; attempt++) {
    const pair = utils.generateKeyPairSync('ed25519')
    const parsed = utils.parseKey(pair.private)
    if (!(parsed instanceof Error)) return pair
  }
  throw new Error('Could not generate parseable ed25519 key')
}

describe('OXE-447 A5 — Remote SSH pane AgentStateService lifecycle (working/blocked/idle) & OxeQuery compatibility', () => {
  const cleanup: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn()
  })

  it('surfaces working, blocked (Needs you), and idle states for remote SSH agents, recovers from drop, and preserves OxeQuery tunnel', async () => {
    const hostKey = freshKeyPair().private
    const echo: TcpServer = createTcpServer(socket => socket.on('data', chunk => socket.write(`echo:${chunk.toString()}`)))
    await new Promise<void>(resolve => echo.listen(0, '127.0.0.1', resolve))
    const echoPort = (echo.address() as { port: number }).port

    let currentChannel: ServerChannel | null = null
    const activeClients = new Set<{ end: () => void }>()
    const server = new SshServer({ hostKeys: [hostKey] }, client => {
      activeClients.add(client)
      client.on('close', () => activeClients.delete(client))
      client.on('authentication', ctx => {
        if (ctx.method === 'password' && ctx.password === 'agent-pass') return ctx.accept()
        ctx.reject()
      })
      client.on('ready', () => {
        client.on('tcpip', (accept, _reject, info) => {
          const channel = accept()
          const upstream = connectTcp(info.destPort, '127.0.0.1')
          channel.pipe(upstream).pipe(channel)
          upstream.on('error', () => channel.close())
        })
        client.on('session', accept => {
          const session = accept()
          session.on('pty', acceptPty => acceptPty?.())
          session.on('window-change', acceptWin => acceptWin?.())
          session.on('shell', acceptShell => {
            currentChannel = acceptShell()
          })
        })
      })
      client.on('error', () => undefined)
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>(resolve => {
      currentChannel?.close()
      for (const c of activeClients) c.end()
      echo.close(() => server.close(() => resolve()))
    }))

    const parsed = utils.parseKey(hostKey)
    const key = Array.isArray(parsed) ? parsed[0] : parsed
    if (key instanceof Error) throw key
    const fingerprint = `SHA256:${createHash('sha256').update(key.getPublicSSH()).digest('base64').replace(/=+$/, '')}`
    const sshPort = (server.address() as { port: number }).port

    // 1. Wire TerminalManager + AgentStateService with a remote SSH pane running Claude.
    const db = openInMemoryDatabase()
    cleanup.push(() => db.close())

    const paneId = 'remote-ssh:host-1:pane-1'
    const workspaceId = 'ws-remote'
    let hostedPty: SshHostedPty | null = null

    const agentState = new AgentStateService({
      manifests: () => BUNDLED_MANIFESTS,
      emit: () => undefined
    })
    cleanup.push(() => agentState.forget(paneId))

    const manager = new TerminalManager(db, {
      observer: agentState,
      remoteSshPane: async (id, geometry) => {
        if (id !== paneId) return undefined
        hostedPty = await createSshHostedPty({
          config: {
            host: '127.0.0.1',
            port: sshPort,
            username: 'dev',
            authType: 'password',
            password: 'agent-pass',
            pinnedFingerprint: fingerprint
          },
          cols: geometry.cols,
          rows: geometry.rows
        })
        return { pty: hostedPty, cwd: '/remote/repo', label: 'prod-box', command: 'claude' }
      }
    })
    cleanup.push(() => manager.stopAllAndDrain())

    await manager.start({ paneId, workspaceId, cols: 100, rows: 30, agentCommand: 'claude' })
    expect(hostedPty).not.toBeNull()
    expect(currentChannel).not.toBeNull()

    // Working state via remote screen output.
    currentChannel!.write('\x1b]0;⠋ Working\x07\r\n✳ Analyzing remote codebase… (2s)\r\n')
    const working = await agentState.waitFor(paneId, ['working'], 4000)
    expect(working.timedOut).toBe(false)
    expect(working.state?.state).toBe('working')
    expect(working.state?.source).toBe('screen')

    // Blocked ("Needs you") state via Claude permission prompt on remote screen.
    currentChannel!.write(
      '\x1b]0;✳ Claude\x07\x1b[2J\x1b[H\r\nBash command\r\n  npm run deploy\r\nDo you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n'
    )
    const blocked = await agentState.waitFor(paneId, ['blocked'], 4000)
    expect(blocked.timedOut).toBe(false)
    expect(blocked.state?.state).toBe('blocked')

    // Idle state once remote agent finishes and returns to prompt.
    currentChannel!.write('\x1b[2J\x1b[H\x1b]0;✳ Ready\x07\r\n────────────────────\r\n❯ \r\n────────────────────\r\n')
    const idle = await agentState.waitFor(paneId, ['idle', 'done'], 4000)
    expect(idle.timedOut).toBe(false)
    if (idle.state?.state === 'done') agentState.markSeen(paneId)
    expect(agentState.get(paneId)?.state).toBe('idle')

    // Abrupt SSH connection drop does not crash manager; reconnect recovers remote agent detection.
    currentChannel!.close()
    for (const c of activeClients) c.end()
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(hostedPty!.state).toBe('disconnected')

    await hostedPty!.reconnect()
    expect(hostedPty!.state).toBe('connected')
    expect(currentChannel).not.toBeNull()
    currentChannel!.write('\x1b]0;⠋ Resumed\x07\r\n✳ Continuing work… (1s)\r\n')
    const resumed = await agentState.waitFor(paneId, ['working'], 4000)
    expect(resumed.timedOut).toBe(false)
    expect(resumed.state?.state).toBe('working')

    // 2. Existing OxeQuery SSH tunnel stays 100% functional via shared SSH core.
    const tunnel = await openTunnel(
      { host: '127.0.0.1', port: sshPort, user: 'dev', password: 'agent-pass', pinnedFingerprint: fingerprint },
      { host: '127.0.0.1', port: echoPort }
    )
    cleanup.push(() => tunnel.close())
    expect(tunnel.fingerprint).toBe(fingerprint)
    const echoed = await new Promise<string>((resolve, reject) => {
      const sock = connectTcp(tunnel.endpoint.port, '127.0.0.1', () => sock.write('oxequery-ok'))
      sock.once('data', chunk => { sock.destroy(); resolve(chunk.toString('utf8')) })
      sock.once('error', reject)
    })
    expect(echoed).toBe('echo:oxequery-ok')
  }, 15_000)
})
