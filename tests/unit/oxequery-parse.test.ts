import { describe, expect, it } from 'vitest'
import { parseContainerList, parseDockerPorts, parseInspect, suggestFromInspect } from '../../electron/main/services/oxequery/container-parse'
import { assertContainerId, assertExecArgv, explainEngineError } from '../../electron/main/services/oxequery/container-runtime'

describe('container list parsing', () => {
  it('reads Docker one-object-per-line output', () => {
    const line = JSON.stringify({ ID: 'abc123', Names: 'pg-dev,alias', Image: 'postgres:16', State: 'running', Status: 'Up 2 hours', Ports: '0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp, 9187/tcp', CreatedAt: '2026-10-11 20:00:00 -0300 -03', Labels: 'a=1,b=2' })
    const [container] = parseContainerList(`${line}\n`)
    expect(container).toMatchObject({ id: 'abc123', name: 'pg-dev', image: 'postgres:16', state: 'running', labels: { a: '1', b: '2' } })
    expect(container.ports).toEqual([
      { hostIp: '0.0.0.0', hostPort: 5432, containerPort: 5432, protocol: 'tcp' },
      { containerPort: 9187, protocol: 'tcp' }
    ])
    expect(container.createdAt).toBe(Date.parse('2026-10-11T20:00:00-03:00'))
  })

  it('reads Podman array output with structured ports', () => {
    const output = JSON.stringify([{ Id: 'def456', Names: ['mongo-dev'], Image: 'docker.io/library/mongo:7', State: 'exited', Status: 'Exited (0)', Created: 1791000000, Ports: [{ host_ip: '', container_port: 27017, host_port: 27018, protocol: 'tcp', range: 1 }], Labels: { k: 'v' } }])
    const [container] = parseContainerList(output)
    expect(container).toMatchObject({ id: 'def456', name: 'mongo-dev', state: 'exited', labels: { k: 'v' }, createdAt: 1791000000000 })
    expect(container.ports).toEqual([{ hostPort: 27018, containerPort: 27017, protocol: 'tcp' }])
  })

  it('ignores garbage lines and expands small port ranges', () => {
    expect(parseContainerList('not json\n{"ID":"a","Names":"x","State":"weird"}')).toMatchObject([{ id: 'a', state: 'unknown' }])
    expect(parseDockerPorts('0.0.0.0:8000-8002->9000-9002/tcp')).toHaveLength(3)
    expect(parseContainerList('')).toEqual([])
  })
})

describe('container inspect and connection suggestion', () => {
  const inspect = (image: string, env: string[], ports: Record<string, unknown>) => JSON.stringify([{
    Id: 'f'.repeat(64), Name: '/db', State: { Status: 'running', StartedAt: '2026-10-11T10:00:00Z' },
    Config: { Image: image, Env: env, Cmd: ['postgres'] }, NetworkSettings: { Ports: ports, Networks: { bridge: {} } }, HostConfig: { RestartPolicy: { Name: 'always' } }, Mounts: []
  }])

  it('never exposes environment values in the inspect summary', () => {
    const summary = parseInspect(inspect('postgres:16', ['POSTGRES_PASSWORD=hunter2'], {}))
    expect(summary?.envNames).toEqual(['POSTGRES_PASSWORD'])
    expect(JSON.stringify(summary)).not.toContain('hunter2')
  })

  it('suggests a Postgres connection from the published port and the container environment', () => {
    const result = suggestFromInspect(inspect('postgres:16', ['POSTGRES_USER=app', 'POSTGRES_PASSWORD=hunter2'], { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '15432' }] }))
    expect(result?.suggestion).toEqual({ engine: 'postgres', name: 'db', host: '127.0.0.1', port: 15432, database: 'app', username: 'app', hasPassword: true })
    expect(result?.password).toBe('hunter2')
    expect(JSON.stringify(result?.suggestion)).not.toContain('hunter2')
  })

  it('detects MongoDB and reports an unpublished port as 0', () => {
    const result = suggestFromInspect(inspect('mongo:7', ['MONGO_INITDB_ROOT_USERNAME=root', 'MONGO_INITDB_ROOT_PASSWORD=pw'], { '27017/tcp': null }))
    expect(result?.suggestion).toMatchObject({ engine: 'mongodb', port: 0, username: 'root', hasPassword: true })
    expect(suggestFromInspect(inspect('nginx', [], { '80/tcp': null }))).toBeNull()
  })
})

describe('container runtime input validation', () => {
  it('accepts normal ids and refuses anything that could be an option or a path', () => {
    expect(assertContainerId('pg-dev_1.a')).toBe('pg-dev_1.a')
    for (const value of ['', '-rf', '--privileged', 'a b', 'a;b', '../x', 'a'.repeat(200), 5 as never]) expect(() => assertContainerId(value)).toThrow()
  })

  it('requires exec arguments as a bounded array of plain strings', () => {
    expect(assertExecArgv(['ls', '-la'])).toEqual(['ls', '-la'])
    for (const value of [[], 'ls -la', [''], ['a\0b'], new Array(65).fill('x'), [1]]) expect(() => assertExecArgv(value as never)).toThrow()
  })

  it('turns daemon and permission failures into actionable messages', () => {
    expect(explainEngineError('docker', 'error during connect: open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file').code).toBe('daemon')
    expect(explainEngineError('docker', 'permission denied while trying to connect to the Docker daemon socket').message).toMatch(/docker group/)
    expect(explainEngineError('podman', 'Error: no such container x').code).toBe('not-found')
  })
})

describe('engine discovery', () => {
  it('lists the platform install locations used when PATH does not have the CLI', async () => {
    const { engineInstallPaths } = await import('../../electron/main/services/oxequery/container-runtime')
    expect(engineInstallPaths('docker', 'win32', { ProgramFiles: String.raw`C:\Program Files` })).toEqual([String.raw`C:\Program Files\Docker\Docker\resources\bin\docker.exe`])
    expect(engineInstallPaths('podman', 'win32', { ProgramFiles: String.raw`C:\Program Files`, LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local` })).toContain(String.raw`C:\Users\me\AppData\Local\Programs\Podman\podman.exe`)
    expect(engineInstallPaths('docker', 'darwin', {})).toContain('/Applications/Docker.app/Contents/Resources/bin/docker')
    expect(engineInstallPaths('podman', 'linux', {})).toEqual(['/usr/bin/podman', '/usr/local/bin/podman'])
  })

  it('finds the CLI at an install path, reports a stopped daemon and recovers when it starts', async () => {
    const { ContainerRuntime } = await import('../../electron/main/services/oxequery/container-runtime')
    let daemonUp = false
    const seen: string[] = []
    const host = {
      id: 'fake', kind: 'local' as const, readTextFile: async () => '', writeTextFile: async () => undefined,
      exec: async (command: string, args: string[]) => {
        seen.push(command)
        const onPath = command === 'docker'
        if (args[0] === 'version') return onPath ? { code: -1, stdout: '', stderr: 'ENOENT', timedOut: false } : command.includes('Docker') ? { code: 0, stdout: '27.1.0\n', stderr: '', timedOut: false } : { code: -1, stdout: '', stderr: 'ENOENT', timedOut: false }
        if (args[0] === 'info') return daemonUp ? { code: 0, stdout: '27.1.0\n', stderr: '', timedOut: false } : { code: 1, stdout: '', stderr: 'error during connect: dockerDesktopLinuxEngine', timedOut: false }
        if (args[0] === 'context') return { code: 0, stdout: 'desktop-linux\n', stderr: '', timedOut: false }
        if (args[0] === 'ps') return { code: 0, stdout: '', stderr: '', timedOut: false }
        return { code: 0, stdout: '', stderr: '', timedOut: false }
      }
    }
    const runtime = new ContainerRuntime({ host, emit: () => undefined, platform: 'win32', env: { ProgramFiles: String.raw`C:\Program Files` } })
    const stopped = await runtime.engines(true)
    expect(stopped.find(info => info.engine === 'docker')).toMatchObject({ available: false, state: 'stopped', binary: String.raw`C:\Program Files\Docker\Docker\resources\bin\docker.exe` })
    expect(stopped.find(info => info.engine === 'podman')).toMatchObject({ state: 'missing' })
    await expect(runtime.list()).rejects.toMatchObject({ code: 'daemon' })
    daemonUp = true
    await runtime.engines(true)
    await expect(runtime.list()).resolves.toMatchObject({ engine: 'docker' })
    // Later calls use the path that answered, not the bare name that did not.
    expect(seen.at(-1)).toBe(String.raw`C:\Program Files\Docker\Docker\resources\bin\docker.exe`)
  })
})
