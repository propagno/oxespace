import { describe, expect, it } from 'vitest'
import { classifyProbe, isLocalEndpoint, parseContexts } from '../../electron/main/services/oxepod/container-parse'
import { ContainerRuntime } from '../../electron/main/services/oxepod/container-runtime'

const CONTEXTS = [
  '{"Name":"default","DockerEndpoint":"unix:///var/run/docker.sock","Current":false}',
  '{"Name":"desktop-linux","DockerEndpoint":"unix:///home/me/.docker/desktop/docker.sock","Current":true}',
  '{"Name":"prod","DockerEndpoint":"ssh://deploy@prod.example.com","Current":false}'
].join('\n')

describe('Docker engine discovery parsing', () => {
  it('reads contexts, ignoring lines that are not contexts or have unsafe names', () => {
    expect(parseContexts(`${CONTEXTS}\nnot json\n{"Name":"--evil","DockerEndpoint":"x"}\n`).map(c => [c.name, c.current])).toEqual([['default', false], ['desktop-linux', true], ['prod', false]])
  })

  it('tells a refused socket from a missing daemon, and never treats remote endpoints as local', () => {
    expect(classifyProbe(0, '')).toBe('ready')
    expect(classifyProbe(1, 'permission denied while trying to connect to the Docker daemon socket')).toBe('denied')
    expect(classifyProbe(1, 'Cannot connect to the Docker daemon')).toBe('unreachable')
    expect(isLocalEndpoint('unix:///var/run/docker.sock')).toBe(true)
    expect(isLocalEndpoint('ssh://deploy@prod.example.com')).toBe(false)
    expect(isLocalEndpoint('tcp://10.0.0.5:2375')).toBe(false)
  })
})

function runtime() {
  const calls: string[][] = []
  const host = {
    id: 'fake', kind: 'local' as const, readTextFile: async () => '', writeTextFile: async () => undefined,
    exec: async (_command: string, args: string[]) => {
      calls.push(args)
      const text = args.join(' ')
      if (args[0] === 'version') return { code: 0, stdout: '27.0.0\n', stderr: '', timedOut: false }
      if (args[0] === 'info') return { code: 0, stdout: '27.0.0\n', stderr: '', timedOut: false }
      if (args[0] === 'context' && args[1] === 'show') return { code: 0, stdout: 'desktop-linux\n', stderr: '', timedOut: false }
      if (args[0] === 'context' && args[1] === 'ls') return { code: 0, stdout: CONTEXTS, stderr: '', timedOut: false }
      if (text.startsWith('--context default ps') && text.includes('--quiet')) return { code: 1, stdout: '', stderr: 'permission denied while trying to connect to the Docker daemon socket', timedOut: false }
      if (text.startsWith('--context desktop-linux ps')) return { code: 0, stdout: '', stderr: '', timedOut: false }
      if (text.includes('ps --all --no-trunc')) return { code: 0, stdout: '', stderr: '', timedOut: false }
      return { code: 0, stdout: '', stderr: '', timedOut: false }
    }
  }
  return { calls, runtime: new ContainerRuntime({ host, emit: () => undefined, platform: 'linux', env: {} }) }
}

describe('ContainerRuntime engine candidates', () => {
  it('shows an empty Docker Desktop, a system engine this user may not use, and never contacts a remote context', async () => {
    const { runtime: r, calls } = runtime()
    const found = await r.candidates()
    expect(found.map(c => [c.id, c.state, c.selected])).toEqual([
      ['context:default', 'denied', false], ['context:desktop-linux', 'ready', true], ['context:prod', 'not-checked', false]
    ])
    expect(found[1].containers).toBe(0)
    expect(calls.some(args => args.includes('prod'))).toBe(false)
  })

  it('points every command at the chosen daemon and refuses an id it did not list', async () => {
    const { runtime: r, calls } = runtime()
    await expect(r.useCandidate('context:nope')).rejects.toThrow(/not available/)
    await expect(r.useCandidate('context:prod')).rejects.toThrow(/Remote/)
    await r.useCandidate('context:default')
    calls.length = 0
    await r.list()
    expect(calls.some(args => args.slice(0, 2).join(' ') === '--context default' && args.includes('ps'))).toBe(true)
    await r.useCandidate(null)
    calls.length = 0
    await r.list()
    expect(calls.some(args => args.includes('--context'))).toBe(false)
  })
})
