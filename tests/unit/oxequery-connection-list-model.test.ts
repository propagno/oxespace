import { describe, expect, it } from 'vitest'
import type { OxeQueryConnection } from '../../shared/types/oxequery'
import { matchesSearch, organize } from '../../src/components/OxeQuery/connection-list-model'

const make = (name: string, extra: Partial<OxeQueryConnection> = {}): OxeQueryConnection => ({
  id: name, name, engine: 'postgres', host: 'db.local', port: 5432, database: 'app', username: '', sslMode: 'disable', readOnly: true, environment: 'local', hasPassword: false, hasCa: false, hasClientCert: false,
  mongo: { authSource: '', replicaSet: '', directConnection: true, srv: false, extraHosts: [] }, statementTimeoutMs: 60000, maxRows: 500, agentAccess: 'off',
  group: '', favorite: false, color: '', maskPatterns: [], lastUsedAt: 0, keepaliveSeconds: 30, createdAt: 1, updatedAt: 1, ...extra
})

describe('organizing the connection list', () => {
  it('puts favorites first, then recent, then groups, then the rest', () => {
    const list = [make('a', { favorite: true, group: 'Ops' }), make('b', { group: 'Ops', lastUsedAt: 50 }), make('c', { group: 'Clients' }), make('d', { lastUsedAt: 90 }), make('e')]
    const sections = organize(list)
    expect(sections.map(section => section.id)).toEqual(['favorites', 'recent', 'group:Clients', 'group:Ops', 'ungrouped'])
    expect(sections[1]!.connections.map(item => item.name)).toEqual(['d', 'b'])
    expect(sections[3]!.connections.map(item => item.name)).toEqual(['a', 'b'])
    expect(sections[4]!.title).toBe('Other')
  })

  it('does not repeat a short list as "recent" and calls a flat list Connections', () => {
    const sections = organize([make('x', { lastUsedAt: 5 }), make('y')])
    expect(sections.map(section => [section.id, section.title])).toEqual([['ungrouped', 'Connections']])
  })

  it('lists unsaved connections apart, never in a group or in recent', () => {
    const sections = organize([make('tmp-1', { ephemeral: true, group: 'Ops', lastUsedAt: 99 }), make('s')])
    expect(sections.map(section => section.id)).toEqual(['unsaved', 'ungrouped'])
  })

  it('searches name, group, host and database in one flat list', () => {
    const list = [make('Billing', { group: 'Clients' }), make('Reports', { host: 'warehouse' }), make('Other')]
    expect(organize(list, 'client').flatMap(section => section.connections.map(item => item.name))).toEqual(['Billing'])
    expect(organize(list, 'WARE')[0]!.title).toBe('Matches (1)')
    expect(organize(list, 'zzz')).toEqual([])
    expect(matchesSearch(list[2]!, '  ')).toBe(true)
  })
})
