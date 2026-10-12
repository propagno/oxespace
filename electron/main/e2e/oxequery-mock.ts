/**
 * In-memory OxeQuery for E2E runs: a fake container engine and two fake
 * databases. It speaks the same `oxeQuery:call` envelope as the real service,
 * so the renderer is exercised end to end without Docker or a network.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ContainerSummary, OxeQueryConnection, OxeQueryErrorInfo, SqlResult } from '../../../shared/types/oxequery'

type Input = Record<string, unknown>

export function registerOxeQueryMock(): void {
  const containers: ContainerSummary[] = [
    { id: 'c1', name: 'pg-dev', image: 'postgres:16', state: 'running', status: 'Up 2 hours', ports: [{ hostIp: '0.0.0.0', hostPort: 5432, containerPort: 5432, protocol: 'tcp' }], labels: {} },
    { id: 'c2', name: 'mongo-dev', image: 'mongo:7', state: 'running', status: 'Up 2 hours', ports: [{ hostIp: '0.0.0.0', hostPort: 27017, containerPort: 27017, protocol: 'tcp' }], labels: {} },
    { id: 'c3', name: 'old-job', image: 'alpine:3', state: 'exited', status: 'Exited (0) 3 days ago', ports: [], labels: {} }
  ]
  const connections: OxeQueryConnection[] = []
  const send = (event: unknown): void => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.oxeQuery.onEvent, event) }
  const fail = (code: OxeQueryErrorInfo['code'], message: string, reasons?: string[]) => ({ ok: false as const, error: { code, message, ...(reasons ? { reasons } : {}) } })
  const ok = <T,>(value: T) => ({ ok: true as const, value })
  const connection = (id: unknown): OxeQueryConnection | undefined => connections.find(item => item.id === id)

  const users: SqlResult = {
    columns: [{ name: 'id', type: 'int4' }, { name: 'name', type: 'text' }, { name: 'email', type: 'text' }],
    rows: [[1, 'alice', 'alice@example.com'], [2, 'bob', null], [3, 'carol', 'carol@example.com']], rowCount: 3, truncated: false, durationMs: 4
  }

  ipcMain.removeHandler(IPC_CHANNELS.oxeQuery.call)
  ipcMain.handle(IPC_CHANNELS.oxeQuery.call, (_event, request: { op: string; input?: Input }) => {
    const input = request.input ?? {}
    switch (request.op) {
      case 'containers.engines':
        if (process.env.OXE_MOCK_ENGINE === 'stopped') return ok([{ engine: 'docker', available: false, state: 'stopped', version: '27.0.0', error: 'docker is installed but its daemon is not reachable. Start Docker Desktop or the Docker service and try again.' }, { engine: 'podman', available: false, state: 'missing', error: 'podman was not found.' }])
        return ok([{ engine: 'docker', available: true, version: '27.0.0', context: 'default' }, { engine: 'podman', available: false, error: 'podman was not found on PATH' }])
      case 'containers.list':
        if (process.env.OXE_MOCK_ENGINE === 'stopped') return fail('daemon', 'docker is installed but its daemon is not reachable. Start Docker Desktop or the Docker service and try again.')
        return ok({ engine: 'docker', containers: containers.map(container => ({ ...container })) })
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
        return ok({ id: target.id, name: target.name, image: target.image, state: target.state, command: 'docker-entrypoint.sh', envNames: ['POSTGRES_PASSWORD', 'PATH'], mounts: [{ source: '/data', destination: '/var/lib/data' }], networks: ['bridge'], ports: target.ports, restartPolicy: 'always' })
      }
      case 'containers.exec': return ok({ exitCode: 0, stdout: `hello from ${String(input.id)}\n`, stderr: '', truncated: false, timedOut: false })
      case 'containers.logsStart': {
        const streamId = randomUUID()
        setTimeout(() => send({ type: 'container-log', streamId, lines: ['2026-10-11T10:00:00Z database system is ready to accept connections', '2026-10-11T10:00:01Z checkpoint starting'] }), 80)
        return ok({ streamId })
      }
      case 'containers.logsStop': return ok({ ok: true })
      case 'containers.shell': return ok({ paneId: `oxequery-shell:${randomUUID()}` })
      case 'connections.list': return ok(connections.map(item => ({ ...item })))
      case 'connections.save': {
        const saved: OxeQueryConnection = { id: String(input.id ?? randomUUID()), name: String(input.name), engine: input.engine as 'postgres' | 'mongodb', host: String(input.host), port: Number(input.port),
          database: String(input.database ?? ''), username: String(input.username ?? ''), sslMode: 'disable', readOnly: input.readOnly !== false, environment: (input.environment as 'local') ?? 'local',
          hasPassword: Boolean(input.password), createdAt: Date.now(), updatedAt: Date.now() }
        const index = connections.findIndex(item => item.id === saved.id)
        if (index >= 0) connections[index] = saved; else connections.push(saved)
        return ok(saved)
      }
      case 'connections.delete': { const index = connections.findIndex(item => item.id === input.id); if (index >= 0) connections.splice(index, 1); return ok({ ok: true }) }
      case 'connections.test': return ok({ ok: true, message: 'Connected', serverVersion: 'PostgreSQL 16.4', latencyMs: 3 })
      case 'connections.fromContainer': {
        const target = containers.find(container => container.id === input.id)
        if (!target) return fail('not-found', 'That container no longer exists.')
        const mongo = /mongo/.test(target.image)
        const created: OxeQueryConnection = { id: randomUUID(), name: target.name, engine: mongo ? 'mongodb' : 'postgres', host: '127.0.0.1', port: mongo ? 27017 : 5432,
          database: mongo ? '' : 'app', username: mongo ? 'root' : 'app', sslMode: 'disable', readOnly: true, environment: 'local', containerRef: target.name, hasPassword: true, createdAt: Date.now(), updatedAt: Date.now() }
        connections.push(created)
        return ok(created)
      }
      case 'sql.schemas': return ok(['public', 'audit'])
      case 'sql.tables': return ok(input.schema === 'public' ? [{ schema: 'public', name: 'users', kind: 'table', approxRows: 3 }, { schema: 'public', name: 'orders', kind: 'table', approxRows: 10 }] : [])
      case 'sql.table': return ok({ columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true, position: 1 }, { name: 'name', type: 'text', nullable: false, primaryKey: false, position: 2 }], indexes: [{ name: 'users_pkey', definition: 'CREATE UNIQUE INDEX users_pkey ON users (id)', unique: true, primary: true }], foreignKeys: [] })
      case 'sql.browse': return ok(users)
      case 'sql.run': {
        const target = connection(input.connectionId)
        const sql = String(input.sql ?? '')
        const mutating = /^\s*(insert|update|delete|drop|truncate|create|alter)/i.test(sql)
        if (target?.readOnly && mutating) return fail('read-only', 'This connection is read-only. Turn read-only off to run statements that change data.')
        if (/^\s*delete\s+from\s+\w+\s*;?\s*$/i.test(sql) && input.confirmed !== true) return fail('confirm', 'This statement is destructive and needs confirmation.', ['DELETE without a WHERE clause affects every row'])
        if (mutating) return ok({ columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 2, command: 'DELETE', affectedRows: 3 })
        return ok(users)
      }
      case 'sql.cancel': return ok({ cancelled: false })
      case 'sql.check': return ok({ kind: 'read', reasons: [], statements: 1 })
      case 'mongo.databases': return ok([{ name: 'shop' }, { name: 'admin' }])
      case 'mongo.collections': return ok(input.database === 'shop' ? [{ name: 'items', type: 'collection' }, { name: 'orders', type: 'collection' }] : [])
      case 'mongo.find': return ok({ documents: [{ _id: { $oid: '507f1f77bcf86cd799439011' }, sku: 'sku-1', qty: 5 }, { _id: { $oid: '507f1f77bcf86cd799439012' }, sku: 'sku-2', qty: 9 }].map(doc => JSON.stringify(doc)), truncated: false, durationMs: 6, total: 2 })
      case 'mongo.aggregate': return ok({ documents: [JSON.stringify({ _id: 'even', n: 60 })], truncated: false, durationMs: 5 })
      case 'mongo.indexes': return ok([{ name: '_id_', keys: '{"_id":1}', unique: true }])
      default: return fail('invalid', 'Unknown OxeQuery operation.')
    }
  })
}
