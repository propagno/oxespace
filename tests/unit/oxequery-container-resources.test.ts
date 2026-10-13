import { describe, expect, it } from 'vitest'
import { parseDiskUsage, parseImages, parseNetworks, parseStats, parseVolumes } from '../../electron/main/services/oxequery/container-parse'

describe('container resource parsers', () => {
  it('parses docker stats lines', () => {
    const stats = parseStats('{"ID":"abc123","Name":"pg","CPUPerc":"12.50%","MemUsage":"60MiB / 2GiB","MemPerc":"2.93%","NetIO":"1kB / 2kB","BlockIO":"0B / 0B","PIDs":"9"}\n')
    expect(stats).toEqual([{ id: 'abc123', name: 'pg', cpuPercent: 12.5, memoryPercent: 2.93, memoryUsage: '60MiB / 2GiB', netIO: '1kB / 2kB', blockIO: '0B / 0B', pids: 9 }])
  })
  it('parses images from docker lines and from a podman array', () => {
    expect(parseImages('{"ID":"sha256:aa11","Repository":"postgres","Tag":"16","Size":"430MB","CreatedSince":"2 weeks ago"}')[0]).toMatchObject({ id: 'aa11', repository: 'postgres', tag: '16' })
    expect(parseImages('[{"Id":"bb22","Names":["docker.io/library/mongo:7"],"Size":700000000}]')[0]).toMatchObject({ id: 'bb22', repository: 'docker.io/library/mongo', tag: '7', size: '700MB' })
  })
  it('ignores a partial trailing line and non-objects', () => {
    expect(parseVolumes('{"Name":"a","Driver":"local"}\n{"Name":"b"')).toEqual([{ name: 'a', driver: 'local' }])
    expect(parseNetworks('"text"\n{"ID":"n1","Name":"bridge","Driver":"bridge","Scope":"local"}')).toHaveLength(1)
  })
  it('parses disk usage', () => {
    expect(parseDiskUsage('{"Type":"Images","TotalCount":"3","Active":"1","Size":"1.2GB","Reclaimable":"800MB (66%)"}')[0]).toMatchObject({ type: 'Images', total: 3, active: 1 })
  })
})
