/**
 * In-memory OxeQuery for E2E runs: a fake container engine and two fake
 * databases. It speaks the same `oxeQuery:call` envelope as the real service,
 * so the renderer is exercised end to end without Docker or a network.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { splitStatements } from '../../../shared/sqlText'
import { maintenanceStatement, planStructure } from '../services/oxequery/ddl-builder'
import type { ContainerSummary, OxeQueryConnection, OxeQueryErrorInfo, SqlResult } from '../../../shared/types/oxequery'

type Input = Record<string, unknown>

export function registerOxeQueryMock(): void {
  const containers: ContainerSummary[] = [
    { id: 'c1', name: 'pg-dev', image: 'postgres:16', state: 'running', status: 'Up 2 hours', ports: [{ hostIp: '0.0.0.0', hostPort: 5432, containerPort: 5432, protocol: 'tcp' }], labels: { 'com.docker.compose.project': 'shop' } },
    { id: 'c2', name: 'mongo-dev', image: 'mongo:7', state: 'running', status: 'Up 2 hours', ports: [{ hostIp: '0.0.0.0', hostPort: 27017, containerPort: 27017, protocol: 'tcp' }], labels: { 'com.docker.compose.project': 'shop' } },
    { id: 'c3', name: 'old-job', image: 'alpine:3', state: 'exited', status: 'Exited (0) 3 days ago', ports: [], labels: {} }
  ]
  const connections: OxeQueryConnection[] = []
  const workspaces = new Map<string, unknown>()
  let tx: { state: 'none' | 'open' | 'failed'; statements: number; since?: number } = { state: 'none', statements: 0 }
  const send = (event: unknown): void => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.oxeQuery.onEvent, event) }
  const fail = (code: OxeQueryErrorInfo['code'], message: string, reasons?: string[]) => ({ ok: false as const, error: { code, message, ...(reasons ? { reasons } : {}) } })
  const ok = <T,>(value: T) => ({ ok: true as const, value })
  const connection = (id: unknown): OxeQueryConnection | undefined => connections.find(item => item.id === id)
  const trusted = new Set<string>()
  const FINGERPRINT = 'SHA256:' + 'k8Yq1mR2vN5xT7wZ0aB3cD6eF9gH2jL4nP6rS8uV0xY'
  const extras = { hasCa: false, hasClientCert: false, mongo: { authSource: '', replicaSet: '', directConnection: true, srv: false, extraHosts: [] as string[] }, statementTimeoutMs: 60000, maxRows: 500, agentAccess: 'off' as const, group: '', favorite: false, color: '' as const, maskPatterns: [] as string[], lastUsedAt: 0, keepaliveSeconds: 30 }

  const users: SqlResult = {
    columns: [{ name: 'id', type: 'int4' }, { name: 'name', type: 'text' }, { name: 'email', type: 'text' }],
    rows: [[1, 'alice', 'alice@example.com'], [2, 'bob', null], [3, 'carol', 'carol@example.com']], rowCount: 3, truncated: false, durationMs: 4
  }
  const BIG_ROWS = 1200
  /** Rows from `offset` of a 1,200-row result; a paged run leaves a page id that says where the next page starts. */
  const bigPage = (offset: number, limit: number, paged: boolean): SqlResult => {
    const last = Math.min(BIG_ROWS, offset + limit)
    const rows = Array.from({ length: last - offset }, (_, index) => [offset + index + 1, `row ${offset + index + 1}`])
    const more = last < BIG_ROWS
    return { columns: [{ name: 'n', type: 'int4' }, { name: 'label', type: 'text' }], rows, rowCount: rows.length, truncated: more, ...(more ? { limitedBy: 'rows' as const } : {}), durationMs: 3, command: 'SELECT', ...(more && paged ? { pageId: `big:${last}` } : {}) }
  }

  ipcMain.removeHandler(IPC_CHANNELS.oxeQuery.call)
  ipcMain.handle(IPC_CHANNELS.oxeQuery.call, (_event, request: { op: string; input?: Input }) => {
    const input = request.input ?? {}
    switch (request.op) {
      case 'system.ping': return ok({ ok: true, drivers: { postgres: true, mongodb: true, ssh: true }, node: process.version })
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
      case 'connections.list': return ok(connections.map(item => ({ ...item })))
      case 'preferences.get': case 'preferences.set': return ok({ historyLimit: Number(input.historyLimit ?? 200), auditRetentionDays: Number(input.auditRetentionDays ?? 90), agentCeiling: { local: 'write', dev: 'write', prod: 'read', ...(input.agentCeiling as object | undefined) } })
      case 'connections.update': {
        const target = connections.find(item => item.id === input.id)
        if (!target) return fail('invalid', 'That connection no longer exists.')
        if (typeof input.group === 'string') target.group = input.group
        if (typeof input.favorite === 'boolean') target.favorite = input.favorite
        if (typeof input.color === 'string') target.color = input.color as OxeQueryConnection['color']
        return ok({ ...target })
      }
      case 'connections.duplicate': {
        const target = connections.find(item => item.id === input.id)
        if (!target) return fail('invalid', 'That connection no longer exists.')
        const copy = { ...target, id: randomUUID(), name: target.name + ' copy', favorite: false }
        connections.push(copy)
        return ok(copy)
      }
      case 'connections.connectEphemeral': {
        const made = { ...extras, id: 'tmp-' + randomUUID(), name: String(input.name), engine: input.engine as 'postgres' | 'mongodb', host: String(input.host), port: Number(input.port), database: String(input.database ?? ''), username: String(input.username ?? ''), sslMode: 'disable' as const, readOnly: input.readOnly !== false, environment: 'local' as const, hasPassword: Boolean(input.password), ephemeral: true, createdAt: Date.now(), updatedAt: Date.now() }
        connections.push(made)
        return ok(made)
      }
      case 'connections.reconnect': return ok({ ok: true, message: 'Connected', serverVersion: 'PostgreSQL 16' })
      case 'connections.export': return ok({ saved: true, count: connections.length })
      case 'connections.import': return ok({ imported: 0, skipped: 0 })
      case 'connections.save': {
        const saved: OxeQueryConnection = { id: String(input.id ?? randomUUID()), name: String(input.name), engine: input.engine as 'postgres' | 'mongodb', host: String(input.host), port: Number(input.port),
          database: String(input.database ?? ''), username: String(input.username ?? ''), readOnly: input.readOnly !== false, environment: (input.environment as 'local') ?? 'local',
          hasPassword: Boolean(input.password), ...extras, group: String(input.group ?? ''), favorite: input.favorite === true, color: (input.color as OxeQueryConnection['color']) ?? '', sslMode: (input.sslMode as OxeQueryConnection['sslMode']) ?? 'disable',
          ...((input.ssh as { enabled?: boolean; host?: string; port?: number; user?: string; auth?: 'key' | 'password' } | undefined)?.enabled
            ? { ssh: { host: String((input.ssh as { host?: string }).host), port: Number((input.ssh as { port?: number }).port ?? 22), user: String((input.ssh as { user?: string }).user), auth: (input.ssh as { auth?: 'key' | 'password' }).auth ?? 'key', hasSecret: true } } : {}),
          createdAt: Date.now(), updatedAt: Date.now() }
        const index = connections.findIndex(item => item.id === saved.id)
        if (index >= 0) connections[index] = saved; else connections.push(saved)
        return ok(saved)
      }
      case 'connections.delete': { const index = connections.findIndex(item => item.id === input.id); if (index >= 0) connections.splice(index, 1); return ok({ ok: true }) }
      case 'sql.editability': return ok({ editable: true, columns: [{ name: 'id', type: 'integer', nullable: false, hasDefault: true, generated: false, key: true }, { name: 'email', type: 'text', nullable: false, hasDefault: false, generated: false, key: false }] })
      case 'sql.previewChanges': return ok({ statements: ['UPDATE "public"."users" SET "email" = $1::text WHERE "id" = $2::integer;'] })
      case 'sql.apply': return ok({ applied: 1, statements: [] })
      case 'sql.structure.preview': return ok(planStructure(String(input.schema), String(input.table), input.action as never))
      case 'sql.structure.apply': return ok({ ...planStructure(String(input.schema), String(input.table), input.action as never), applied: true, durationMs: 1 })
      case 'sql.maintenance': return ok({ statement: maintenanceStatement(String(input.schema), String(input.table), String(input.action)), durationMs: 1 })
      case 'mongo.write': return ok({ matched: 1, modified: 1, deleted: 0 })
      case 'import.preview': return ok({ importId: 'imp-mock', fileName: 'users.csv', format: 'csv', bytes: 96, fields: ['id', 'email'], sample: [['1', 'a@example.com'], ['2', 'b@example.com']],
        targetColumns: [{ name: 'id', type: 'integer', nullable: false, hasDefault: true, generated: false }, { name: 'email', type: 'text', nullable: false, hasDefault: false, generated: false }], mapping: { id: 'id', email: 'email' }, options: { delimiter: 'auto', hasHeader: true, encoding: 'auto' }, detected: { delimiter: ',', encoding: 'utf-8' } })
      case 'import.reparse': return ok({ importId: 'imp-mock', fileName: 'users.csv', format: 'csv', bytes: 96, fields: (input.options as { hasHeader?: boolean } | undefined)?.hasHeader === false ? ['column_1', 'column_2'] : ['id', 'email'], sample: [['1', 'a@example.com']],
        targetColumns: [], mapping: (input.options as { hasHeader?: boolean } | undefined)?.hasHeader === false ? {} : { id: 'id', email: 'email' }, options: input.options, detected: { delimiter: ';', encoding: 'windows-1252' } })
      case 'import.run': return ok({ dryRun: Boolean((input as { dryRun?: boolean }).dryRun), inserted: 2, rejected: 0, rejects: [], durationMs: 3 })
      case 'import.cancel': return ok({ cancelled: false })
      case 'sql.explain': return ok({ analyze: Boolean((input as { analyze?: boolean }).analyze), nodeCount: 2, hints: [], planningMs: 0.2, executionMs: 1.4,
        plan: { nodeType: 'Sort', startupCost: 1, totalCost: 9, planRows: 3, selfCostShare: 0.1, children: [{ nodeType: 'Seq Scan', relation: 'public.users', startupCost: 0, totalCost: 8, planRows: 3, selfCostShare: 0.9, children: [] }] } })
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
      case 'containers.createDatabase': return ok({ ...connections[0], id: 'new-db', name: String((input as { name?: string }).name) })
      case 'audit.list': return ok([{ id: 1, ts: Date.now(), actor: 'thread:abc', connectionId: 'c1', connectionName: 'pg-dev', engine: 'postgres', environment: 'dev', tool: 'oxespace_db_query', textHash: 'h', text: "SELECT * FROM users WHERE email = '?'", decision: 'approved', outcome: 'ok', rows: 3, durationMs: 5, errorCode: null }])
      case 'library.list': return ok({ saved: [{ id: 's1', connectionId: String(input.connectionId), name: 'Active users', sql: 'SELECT * FROM users', createdAt: 1, updatedAt: 1 }], history: [{ id: 1, sql: 'SELECT now()', ranAt: Date.now(), durationMs: 3, rows: 1, ok: true }] })
      case 'library.save': return ok({ id: 's2', connectionId: String(input.connectionId), name: String(input.name), sql: String(input.sql), createdAt: 1, updatedAt: 1 })
      case 'library.delete': return ok({ deleted: true })
      case 'library.clearHistory': return ok({ deleted: 1 })
      case 'mongo.schema': return ok({ sampled: 3, truncated: false, fields: [{ path: '_id', presence: 100, types: [{ type: 'objectId', count: 3 }] }, { path: 'sku', presence: 100, types: [{ type: 'string', count: 3 }] }] })
      case 'mongo.createIndex': return ok({ name: 'sku_1' })
      case 'mongo.dropIndex': return ok({ dropped: true })
      case 'sql.functions': return ok(input.schema === 'public' ? [{ oid: 4001, name: 'touch', args: '', kind: 'function' }] : [])
      case 'sql.objects': return ok(input.schema === 'public' ? { sequences: [{ name: 'ticket_seq', dataType: 'bigint', lastValue: 7 }], types: [{ oid: 4002, name: 'mood', kind: 'enum', values: ['sad', 'happy'] }], triggers: [], truncated: false } : { sequences: [], types: [], triggers: [], truncated: false })
      case 'sql.databases': return ok([{ name: 'app', owner: 'oxe', encoding: 'UTF8', sizeBytes: 8388608, connectionLimit: -1, current: true }, { name: 'reports', owner: 'oxe', encoding: 'UTF8', sizeBytes: 7340032, connectionLimit: -1, current: false }])
      case 'sql.roles': return ok([{ name: 'oxe', superuser: true, createDatabase: true, createRole: true, login: true, replication: false, connectionLimit: -1, memberOf: [] }, { name: 'readers', superuser: false, createDatabase: false, createRole: false, login: false, replication: false, connectionLimit: -1, memberOf: [] }])
      case 'sql.createDatabase': case 'sql.dropDatabase': return ok({ ok: true })
      case 'sql.extensions': return ok([{ name: 'pgcrypto', version: '1.3', schema: 'public' }])
      case 'sql.search': {
        const needle = String(input.query ?? '').toLowerCase()
        const all = [{ kind: 'table', schema: 'public', name: 'users' }, { kind: 'table', schema: 'public', name: 'orders' }, { kind: 'table', schema: 'audit', name: 'users_log' }, { kind: 'type', schema: 'public', name: 'mood', oid: 4002 }]
        return ok({ hits: all.filter(hit => hit.name.includes(needle)), truncated: false })
      }
      case 'sql.definition': if (input.kind === 'type') return ok({ text: "CREATE TYPE \"public\".\"mood\" AS ENUM ('sad', 'happy');" }); return ok({ text: 'CREATE TABLE "public"."users" (\n  "id" integer NOT NULL,\n  CONSTRAINT "users_pkey" PRIMARY KEY (id)\n);' })
      case 'export.run': return ok({ rows: 3, bytes: 128, durationMs: 4, path: 'C:/exports/users.csv', fileName: 'users.csv' })
      case 'export.cancel': return ok({ cancelled: false })
      case 'files.pick': return ok({ handle: randomUUID(), name: `${String(input.kind)}.pem` })
      case 'connections.knownHosts': return ok([])
      case 'connections.forgetHostKey': return ok({ ok: true })
      case 'connections.trustHostKey': trusted.add(String(input.id)); return ok({ ok: true })
      case 'connections.test': {
        const target = connection(input.id)
        if (target?.ssh && !trusted.has(target.id)) return ok({ ok: false, message: 'Host key not trusted', code: 'host-key-unknown', reasons: [FINGERPRINT] })
        return ok({ ok: true, message: 'Connected', serverVersion: 'PostgreSQL 16.4', latencyMs: 3 })
      }
      case 'connections.fromContainer': {
        const target = containers.find(container => container.id === input.id)
        if (!target) return fail('not-found', 'That container no longer exists.')
        const mongo = /mongo/.test(target.image)
        const created: OxeQueryConnection = { id: randomUUID(), name: target.name, engine: mongo ? 'mongodb' : 'postgres', host: '127.0.0.1', port: mongo ? 27017 : 5432,
          database: mongo ? '' : 'app', username: mongo ? 'root' : 'app', sslMode: 'disable', readOnly: true, environment: 'local', containerRef: target.name, hasPassword: true, ...extras, createdAt: Date.now(), updatedAt: Date.now() }
        connections.push(created)
        return ok(created)
      }
      case 'sql.schemas': return ok(['public', 'audit'])
      case 'sql.tables': return ok(input.schema === 'public' ? { tables: [{ schema: 'public', name: 'users', kind: 'table', approxRows: 3 }, { schema: 'public', name: 'orders', kind: 'table', approxRows: 10 }, { schema: 'public', name: 'active_users', kind: 'view' }, { schema: 'public', name: 'daily_totals', kind: 'materialized view' }], total: 4 } : { tables: [], total: 0 })
      case 'sql.table': return ok({ columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true, position: 1 }, { name: 'name', type: 'text', nullable: false, primaryKey: false, position: 2 }], indexes: [{ name: 'users_pkey', definition: 'CREATE UNIQUE INDEX users_pkey ON users (id)', unique: true, primary: true }], foreignKeys: [], constraints: [{ name: 'users_pkey', kind: 'primary', definition: 'PRIMARY KEY (id)' }], properties: { kind: 'table', owner: 'oxe', sizeBytes: 16384, estimatedRows: 2 }, dependents: [{ kind: 'view', schema: 'public', name: 'active_users' }], privileges: [{ grantee: 'oxe', privilege: 'SELECT', grantable: true }] })
      case 'sql.browse': return ok(users)
      // 1,200 rows read page by page, as a long SELECT is in the editor.
      case 'sql.more': return ok(bigPage(Number(String(input.pageId).split(':')[1]), Number(input.maxRows ?? 500), true))
      case 'sql.run': {
        const target = connection(input.connectionId)
        const sql = String(input.sql ?? '')
        const mutating = /^\s*(insert|update|delete|drop|truncate|create|alter)/i.test(sql)
        if (target?.readOnly && mutating) return fail('read-only', 'This connection is read-only. Turn read-only off to run statements that change data.')
        if (/^\s*delete\s+from\s+\w+\s*;?\s*$/i.test(sql) && input.confirmed !== true) return fail('confirm', 'This statement is destructive and needs confirmation.', ['DELETE without a WHERE clause affects every row'])
        if (/^\s*selec\s/i.test(sql)) return fail('query', 'syntax error at or near "SELEC"')
        if (mutating) return ok({ columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 2, command: 'DELETE', affectedRows: 3 })
        if (/\bfrom\s+big\b/i.test(sql)) return ok(bigPage(0, Number(input.maxRows ?? 500), input.paged === true))
        return ok(users)
      }
      case 'sql.script': {
        const sql = String(input.sql ?? '')
        const spans = splitStatements(sql)
        return ok({ statements: spans.map((span, index) => ({ index, start: span.start, end: span.end, sql: span.text.slice(0, 200), result: users })) })
      }
      case 'sql.tx': {
        const action = String(input.action)
        if (action === 'begin') tx = { state: 'open', statements: 0, since: Date.now() }
        else if (action === 'commit' || action === 'rollback') tx = { state: 'none', statements: 0 }
        return ok(tx)
      }
      case 'workspace.load': return ok({ state: workspaces.get(String(input.connectionId)) ?? null })
      case 'workspace.save': workspaces.set(String(input.connectionId), input.state); return ok({ ok: true })
      case 'sql.cancel': return ok({ cancelled: false })
      case 'sql.check': return ok({ kind: 'read', reasons: [], statements: 1 })
      case 'mongo.databases': return ok([{ name: 'shop' }, { name: 'admin' }])
      case 'mongo.collections': return ok(input.database === 'shop' ? [{ name: 'items', type: 'collection' }, { name: 'orders', type: 'collection' }] : [])
      case 'mongo.document': return ok({ text: JSON.stringify({ _id: { $oid: '507f1f77bcf86cd799439011' }, sku: 'sku-1', qty: 5 }) })
      case 'mongo.find': return ok({ documents: [{ _id: { $oid: '507f1f77bcf86cd799439011' }, sku: 'sku-1', qty: 5 }, { _id: { $oid: '507f1f77bcf86cd799439012' }, sku: 'sku-2', qty: 9 }].map(doc => JSON.stringify(doc)), truncated: false, durationMs: 6, total: 2 })
      case 'mongo.aggregate': return ok({ documents: [JSON.stringify({ _id: 'even', n: 60 })], truncated: false, durationMs: 5 })
      case 'mongo.bulk': return ok({ matched: 3, modified: input.dryRun === true ? 0 : 3, deleted: 0, dryRun: input.dryRun === true })
      case 'mongo.collection': return ok({ ok: true })
      case 'mongo.stats': return ok({ documents: 1200, sizeBytes: 480000, avgDocumentBytes: 400, storageBytes: 262144, indexes: 2, indexBytes: 65536, capped: false })
      case 'mongo.validation': return ok({ validator: null, level: 'strict', action: 'error' })
      case 'mongo.setValidation': return ok({ ok: true })
      case 'mongo.explain': return ok({ stage: 'COLLSCAN', keysExamined: 0, docsExamined: 1200, returned: 3, timeMs: 4, stages: ['COLLSCAN'], warnings: ['The whole collection is read: no index serves this query. An index on the filtered or sorted fields would help.'], raw: '{"queryPlanner":{}}' })
      case 'mongo.cancel': return ok({ cancelled: false })
      case 'mongo.indexes': return ok([{ name: '_id_', keys: '{"_id":1}', unique: true }])
      default: return fail('invalid', 'Unknown OxeQuery operation.')
    }
  })
}
