/**
 * In-memory OxePod for E2E runs: a fake container engine. It speaks the same `oxePod:call` envelope as the real
 * service, so the renderer is exercised end to end without Docker. OxeQuery's mock reads the same containers for
 * `connections.fromContainer`, as the real OxeQuery reads OxePod in process.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ContainerSummary, OxePodErrorInfo, OxePodEvent } from '../../../shared/types/oxepod'

type Input = Record<string, unknown>

/** The containers of the fake engine; actions change them in place. */
export const mockContainers: ContainerSummary[] = [
  { id: 'c1', name: 'pg-dev', image: 'postgres:16', state: 'running', status: 'Up 2 hours', ports: [{ hostIp: '0.0.0.0', hostPort: 5432, containerPort: 5432, protocol: 'tcp' }], labels: { 'com.docker.compose.project': 'shop' } },
  { id: 'c2', name: 'mongo-dev', image: 'mongo:7', state: 'running', status: 'Up 2 hours', ports: [{ hostIp: '0.0.0.0', hostPort: 27017, containerPort: 27017, protocol: 'tcp' }], labels: { 'com.docker.compose.project': 'shop' } },
  { id: 'c3', name: 'old-job', image: 'alpine:3', state: 'exited', status: 'Exited (0) 3 days ago', ports: [], labels: {} }
]

export function registerOxePodMock(): void {
  const containers = mockContainers
  const send = (event: OxePodEvent): void => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.oxePod.onEvent, event) }
  const fail = (code: OxePodErrorInfo['code'], message: string) => ({ ok: false as const, error: { code, message } })
  const ok = <T,>(value: T) => ({ ok: true as const, value })

  ipcMain.removeHandler(IPC_CHANNELS.oxePod.call)
  ipcMain.handle(IPC_CHANNELS.oxePod.call, (_event, request: { op: string; input?: Input }) => {
    const input = request.input ?? {}
    switch (request.op) {
      case 'containers.candidates': return ok([])
      case 'containers.useCandidate': return ok([])
      case 'containers.engines':
        if (process.env.OXE_MOCK_ENGINE === 'stopped') return ok([{ engine: 'docker', available: false, state: 'stopped', version: '27.0.0', error: 'docker is installed but its daemon is not reachable. Start Docker Desktop or the Docker service and try again.' }, { engine: 'podman', available: false, state: 'missing', error: 'podman was not found.' }])
        return ok([{ engine: 'docker', available: true, version: '27.0.0', context: 'default' }, { engine: 'podman', available: false, error: 'podman was not found on PATH' }])
      case 'containers.list':
        if (process.env.OXE_MOCK_ENGINE === 'stopped') return fail('daemon', 'docker is installed but its daemon is not reachable. Start Docker Desktop or the Docker service and try again.')
        return ok({ engine: 'docker', containers: containers.map(container => ({ ...container })) })
      case 'containers.compose': {
        if (input.action === 'down' && input.confirmed !== true) return fail('confirm', 'Taking a project down removes its containers and networks.')
        return ok({ output: input.action === 'logs' ? 'web-1  | ready\napi-1  | listening' : 'done' })
      }
      case 'containers.action': {
        const target = containers.find(container => container.id === input.id || container.name === input.id)
        if (!target) return fail('not-found', 'That container no longer exists.')
        target.state = input.action === 'stop' ? 'exited' : 'running'
        target.status = target.state === 'running' ? 'Up a few seconds' : 'Exited (0) just now'
        send({ type: 'containers-changed' })
        return ok({ ok: true })
      }
      case 'containers.inspect': {
        const target = containers.find(container => container.id === input.id)
        if (!target) return fail('not-found', 'That container no longer exists.')
        return ok({ id: target.id, name: target.name, image: target.image, state: target.state, command: 'docker-entrypoint.sh', startedAt: Date.now() - 2 * 3_600_000, environment: [{ name: 'POSTGRES_USER', value: 'app' }, { name: 'POSTGRES_PASSWORD' }, { name: 'PGDATA', value: '/var/lib/postgresql/data' }], mounts: [{ source: '/var/lib/docker/volumes/pg-data/_data', destination: '/var/lib/postgresql/data', volume: 'pg-data' }], networks: ['bridge'], ports: target.ports, restartPolicy: 'always' })
      }
      case 'containers.exec': return ok({ exitCode: 0, stdout: `hello from ${String(input.id)}\n`, stderr: '', truncated: false, timedOut: false })
      case 'containers.logsStart': {
        const streamId = randomUUID()
        setTimeout(() => send({ type: 'container-log', streamId, lines: ['2026-10-11T10:00:00Z database system is ready to accept connections', '2026-10-11T10:00:01Z checkpoint starting'] }), 80)
        return ok({ streamId })
      }
      case 'containers.logsStop': return ok({ ok: true })
      case 'containers.shell': return ok({ paneId: `oxequery-shell:${randomUUID()}` })
      case 'containers.stats': return ok([{ id: 'c1', name: 'pg-dev', cpuPercent: 1.5, memoryPercent: 3, memoryUsage: '60MiB / 2GiB', netIO: '1kB / 2kB', blockIO: '0B / 0B', pids: 8 }])
      case 'resources.images': return ok([{ id: 'img1', repository: 'postgres', tag: '16', size: '430MB', created: '2 weeks ago' }])
      case 'resources.volumes': return ok([{ name: 'pg-dev-data', driver: 'local' }])
      case 'resources.networks': return ok([{ id: 'n1', name: 'bridge', driver: 'bridge', scope: 'local' }, { id: 'n2', name: 'app-net', driver: 'bridge', scope: 'local' }])
      case 'resources.usage': return ok([{ type: 'Images', total: 3, active: 1, size: '1.2GB', reclaimable: '800MB (66%)' }])
      case 'resources.remove': return ok({ ok: true })
      case 'resources.prune': {
        if (input.confirmed !== true) return fail('confirm', 'Every stopped container is removed.')
        if (input.kind === 'containers') for (let index = containers.length - 1; index >= 0; index--) if (containers[index].state !== 'running') containers.splice(index, 1)
        send({ type: 'containers-changed' })
        return ok({ output: 'Total reclaimed space: 0B' })
      }
      case 'containers.remove': {
        if (input.confirmed !== true) return fail('confirm', 'Removing a container cannot be undone.')
        const index = containers.findIndex(container => container.id === input.id)
        if (index < 0) return fail('not-found', 'That container no longer exists.')
        containers.splice(index, 1)
        send({ type: 'containers-changed' })
        return ok({ ok: true })
      }
      case 'containers.suggestConnection': {
        const target = containers.find(container => container.id === input.id)
        if (!target || !/postgres|mongo/.test(target.image)) return ok(null)
        const mongo = /mongo/.test(target.image)
        return ok({ engine: mongo ? 'mongodb' : 'postgres', name: target.name, host: '127.0.0.1', port: mongo ? 27017 : 5432, database: mongo ? '' : 'app', username: mongo ? 'root' : 'app', hasPassword: true })
      }
      default: return fail('invalid', `The E2E mock has no OxePod operation ${String(request.op)}.`)
    }
  })
}
