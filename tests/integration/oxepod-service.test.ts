import { describe, expect, it, vi } from 'vitest'
import type { ExecOptions, ExecResult, ExecutionHost } from '../../electron/main/runtime/execution-host'
import { OxePodService } from '../../electron/main/services/oxepod/service'
import type { OxePodEvent } from '../../shared/types/oxepod'

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '', timedOut: false })

const pgInspect = JSON.stringify([{
  Id: 'a'.repeat(64), Name: '/pg-dev', State: { Status: 'running' },
  Config: { Image: 'postgres:16', Env: ['POSTGRES_USER=app', 'POSTGRES_DB=shop', 'POSTGRES_PASSWORD=s3cret-pw'] },
  NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55432' }] }, Networks: {} }, HostConfig: {}, Mounts: []
}])

function fixture() {
  const calls: { command: string; args: string[] }[] = []
  const host: ExecutionHost = {
    id: 'fake', kind: 'local',
    exec: vi.fn(async (command: string, args: string[], _options: ExecOptions) => {
      calls.push({ command, args })
      if (args[0] === 'version') return ok(command === 'docker' ? '27.0.0\n' : '')
      if (args[0] === 'info') return command === 'docker' ? ok('27.0.0\n') : { code: -1, stdout: '', stderr: 'not found', timedOut: false }
      if (args[0] === 'context') return ok('default\n')
      if (args[0] === 'ps') return ok(`${JSON.stringify({ ID: 'a'.repeat(64), Names: 'pg-dev', Image: 'postgres:16', State: 'running', Status: 'Up 1 minute', Ports: '0.0.0.0:55432->5432/tcp' })}\n`)
      if (args[0] === 'inspect') return ok(pgInspect)
      if (args[0] === 'exec') return { code: 0, stdout: 'hi\n', stderr: '', timedOut: false }
      return ok()
    }),
    readTextFile: vi.fn(), writeTextFile: vi.fn()
  }
  const events: OxePodEvent[] = []
  const service = new OxePodService({ host, emit: event => events.push(event) })
  return { service, events, calls }
}

describe('OxePod service', () => {
  it('lists containers through the CLI with an argv, never a shell string', async () => {
    const { service, calls } = fixture()
    const response = await service.call('containers.list', {})
    expect(response).toMatchObject({ ok: true, value: { engine: 'docker', containers: [{ name: 'pg-dev', state: 'running' }] } })
    const ps = calls.find(call => call.args[0] === 'ps')!
    expect(ps.command).toBe('docker')
    expect(ps.args).toEqual(['ps', '--all', '--no-trunc', '--format', '{{json .}}'])
  })

  it('reports an unusable engine with a message a person can act on', async () => {
    const host: ExecutionHost = { id: 'x', kind: 'local', exec: async () => ({ code: -1, stdout: '', stderr: 'spawn ENOENT', timedOut: false }), readTextFile: vi.fn(), writeTextFile: vi.fn() }
    const service = new OxePodService({ host, emit: () => undefined })
    const response = await service.call('containers.list', {})
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error).toMatchObject({ code: 'engine-missing' })
  })

  it('rejects hostile container identifiers and exec arguments before running anything', async () => {
    const { service, calls } = fixture()
    for (const id of ['--privileged', 'a;b', '$(id)', '../x', '']) {
      const response = await service.call('containers.inspect', { id })
      expect(response.ok).toBe(false)
    }
    const exec = await service.call('containers.exec', { id: 'pg-dev', argv: [] })
    expect(exec.ok).toBe(false)
    expect(calls.some(call => call.args[0] === 'inspect' || call.args[0] === 'exec')).toBe(false)
  })

  it('suggests a connection to the database in a container, never with its password', async () => {
    const { service } = fixture()
    const response = await service.call('containers.suggestConnection', { id: 'pg-dev' })
    expect(response).toMatchObject({ ok: true, value: { engine: 'postgres', name: 'pg-dev', port: 55432, database: 'shop', username: 'app', hasPassword: true } })
    expect(JSON.stringify(response)).not.toContain('s3cret-pw')
  })

  it('registers a shell only for a validated container and returns an opaque pane id', async () => {
    const { service } = fixture()
    const response = await service.call('containers.shell', { id: 'pg-dev', shell: 'bash' })
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.value.paneId).toMatch(/^oxequery-shell:[0-9a-f-]{36}$/)
    expect(service.shellFor(response.value.paneId)).toEqual({ file: 'docker', args: ['exec', '-it', 'pg-dev', 'bash'] })
    expect(service.shellFor('oxequery-shell:not-registered')).toBeUndefined()
    expect((await service.call('containers.shell', { id: '--rm' })).ok).toBe(false)
  })

  it('rejects unknown operations, OxeQuery operations, bad arguments and a malformed request', async () => {
    const { service, calls } = fixture()
    for (const op of ['nope', 'connections.list', 'sql.run', 'connections.fromContainer', 'containers.createDatabase']) {
      await expect(service.call(op as never, {})).resolves.toEqual({ ok: false, error: { code: 'invalid', message: 'Unknown OxePod operation.' } })
    }
    await expect(service.call('containers.list', 'text' as never)).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    await expect(service.call('containers.list', { engine: 'lxc' } as never)).resolves.toMatchObject({ ok: false, error: { code: 'invalid', message: 'Unknown container engine.' } })
    await expect(service.call('containers.action', { id: 'pg-dev', action: 'kill' } as never)).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    await expect(service.call('containers.compose', { id: 'pg-dev', action: 'build' } as never)).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    await expect(service.call('containers.logsStart', { id: 'pg-dev', tail: 1e9 })).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    await expect(service.call('containers.useCandidate', { id: 42 } as never)).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    await expect(service.call('resources.remove', { kind: 'secret', id: 'x' } as never)).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(calls).toEqual([])
  })

  it('asks for confirmation before taking a Compose project down', async () => {
    const { service, calls } = fixture()
    await expect(service.call('containers.compose', { id: 'pg-dev', action: 'down' })).resolves.toMatchObject({ ok: false, error: { code: 'confirm', reasons: ['Named volumes are kept.', 'Anything running from this project stops.'] } })
    expect(calls).toEqual([])
  })
})

describe('destructive resource operations', () => {
  it('removes a volume only when the request carries the confirmation', async () => {
    const { service, calls } = fixture()
    await expect(service.call('resources.remove', { kind: 'volume', id: 'pgdata' })).resolves.toMatchObject({ ok: false, error: { code: 'confirm' } })
    expect(calls.some(call => call.args[0] === 'volume' && call.args[1] === 'rm')).toBe(false)
    await expect(service.call('resources.remove', { kind: 'volume', id: 'pgdata', confirmed: true })).resolves.toMatchObject({ ok: true })
    expect(calls.some(call => call.args[0] === 'volume' && call.args.includes('rm'))).toBe(true)
  })

  it('removes a container only when the request carries the confirmation, and keeps its volumes', async () => {
    const { service, calls, events } = fixture()
    const id = 'a'.repeat(64)
    await expect(service.call('containers.remove', { id })).resolves.toMatchObject({ ok: false, error: { code: 'confirm' } })
    expect(calls.some(call => call.args.includes('rm'))).toBe(false)
    await expect(service.call('containers.remove', { id, confirmed: true })).resolves.toEqual({ ok: true, value: { ok: true } })
    const removal = calls.find(call => call.args.includes('rm'))
    expect(removal?.args.slice(-3)).toEqual(['rm', '--force', id])
    expect(removal?.args).not.toContain('--volumes')
    expect(events).toContainEqual({ type: 'containers-changed' })
    await expect(service.call('containers.remove', { id: 'x; rm -rf /', confirmed: true })).resolves.toMatchObject({ ok: false })
  })

  it('cleans up stopped containers or dangling images only when confirmed, and nothing else', async () => {
    const { service, calls } = fixture()
    for (const kind of ['containers', 'images'] as const) {
      await expect(service.call('resources.prune', { kind })).resolves.toMatchObject({ ok: false, error: { code: 'confirm' } })
      expect(calls.some(call => call.args.includes('prune'))).toBe(false)
    }
    await expect(service.call('resources.prune', { kind: 'containers', confirmed: true })).resolves.toMatchObject({ ok: true })
    await expect(service.call('resources.prune', { kind: 'images', confirmed: true })).resolves.toMatchObject({ ok: true })
    expect(calls.filter(call => call.args.includes('prune')).map(call => call.args.slice(-3))).toEqual([['container', 'prune', '--force'], ['image', 'prune', '--force']])
    await expect(service.call('resources.prune', { kind: 'volumes', confirmed: true })).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
  })
})
