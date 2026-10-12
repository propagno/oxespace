import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadCommandService } from '../electron/main/services/conversation/thread-commands'
import type { ConversationThread } from '../shared/types/thread'
import type { ConversationTransport } from '../electron/main/services/conversation/codex-conversation'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => {
  const target = resolve(root)
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('oxe-thread-commands-')) throw Error('Invalid fixture cleanup path')
  return rm(target, { recursive: true, force: true })
})) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oxe-thread-commands-')); roots.push(root)
  const home = join(root, 'home'), project = join(root, 'repo')
  await mkdir(join(project, '.git'), { recursive: true }); await mkdir(home)
  const thread = { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: project, provider: 'claude' } as ConversationThread
  const file = async (path: string, text: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, text) }
  return { home, project, thread, file }
}
const markdown = (name: string, body: string, metadata = '') => `---\nname: ${name}\ndescription: Run ${name}\n${metadata}---\n${body}`
function nativeFixture() {
  const requests: { method: string; params: unknown }[] = []
  const transports: ConversationTransport[] = []
  const factory = () => {
    let receive: (chunk: Uint8Array) => void = () => {}
    const transport: ConversationTransport = { onData: listener => { receive = listener }, onClose: () => {}, close: vi.fn(async () => {}), write: line => {
      const message = JSON.parse(line); requests.push(message)
      if (message.id === undefined) return
      const result = message.method === 'skills/list' ? { data: [{ skills: [
        { name: 'oxe-plan', description: 'Plan a change', path: '/native/oxe-plan/SKILL.md', enabled: true },
        { name: 'disabled', description: 'Hidden', path: '/native/disabled/SKILL.md', enabled: false }
      ] }] } : {}
      queueMicrotask(() => receive(Buffer.from(JSON.stringify({ id: message.id, result }) + '\n')))
    } }
    transports.push(transport); return transport
  }
  return { factory, requests, transports }
}
function claudeFixture() {
  const transports: ConversationTransport[] = []
  const factory = vi.fn((_command?: string, _cwd?: string) => {
    let receive: (chunk: Uint8Array) => void = () => {}
    const transport: ConversationTransport = { onData: listener => { receive = listener }, onClose: () => {}, close: vi.fn(async () => {}), write: line => {
      const message = JSON.parse(line)
      expect(message.type).toBe('control_request')
      expect(message.request.subtype).toBe('initialize')
      queueMicrotask(() => receive(Buffer.from(JSON.stringify({ type: 'control_response', response: { request_id: message.request_id, subtype: 'success', response: {
        commands: [{ name: 'oxe-plan', description: 'Native project command', argumentHint: '<focus>' }, { name: 'test:review', description: 'Plugin' }, { name: 'model', description: 'Change model' }, { name: 'clear', description: 'Clear native context', aliases: ['new', 'reset'] }],
        account: { secret: 'never cross IPC' }, models: [{ value: 'internal' }]
      } } }) + '\n')))
    } }; transports.push(transport); return transport
  })
  return { factory, transports }
}

describe('Thread command catalog and dispatch', () => {
  it('discovers commands, plugins and aliases from the installed Claude CLI without prompting a model', async () => {
    const f = await fixture()
    const native = claudeFixture()
    const service = new ThreadCommandService(() => 'claude', { home: f.home, claudeTransport: native.factory })
    const nested = { ...f.thread, rootPath: join(f.project, 'nested') }; await mkdir(nested.rootPath)
    const catalog = await service.list(nested)
    expect(native.factory).toHaveBeenCalledWith('claude', nested.rootPath)
    expect(catalog.commands.find(command => command.name === 'oxe-plan')).toMatchObject({ description: 'Native project command', source: 'claude', argumentHint: '<focus>' })
    expect(catalog.commands.map(command => command.name)).toEqual(expect.arrayContaining(['clear', 'compact', 'model', 'new', 'oxe-plan', 'reset', 'test:review', 'permissions', 'plugin', 'resume', 'login', 'delegations', 'delegation']))
    expect(JSON.stringify(catalog)).not.toContain('never cross IPC')
    expect(await service.prepare(nested, '/oxe-plan Review auth')).toEqual({ text: '/oxe-plan Review auth' })
    expect(await service.prepare(nested, '/model')).toEqual({ text: '/model' })
    await expect(service.prepare(nested, '/bundled-command')).rejects.toThrow('Unknown command')
    expect(native.transports.every(transport => vi.mocked(transport.close).mock.calls.length === 1)).toBe(true)
  })
  it('expands OXE skill arguments and isolates workspace overrides and provider compatibility', async () => {
    const f = await fixture(), second = join(f.home, 'second'); await mkdir(second)
    await f.file(join(f.home, '.oxe/skills/review.md'), markdown('review', 'User {{argument}}'))
    await f.file(join(f.project, '.oxe/skills/review.md'), markdown('review', 'Project {{argument}}'))
    await f.file(join(f.project, '.oxe/skills/codex-only.md'), markdown('codex-only', 'Codex only', 'agents: [codex]\n'))
    const service = new ThreadCommandService(() => 'claude', { home: f.home, claudeTransport: claudeFixture().factory })
    const inputs = await Promise.all([service.prepare(f.thread, '/review Auth'), service.prepare({ ...f.thread, rootPath: second }, '/review Other')])
    expect(inputs).toEqual([{ text: 'Project Auth' }, { text: 'User Other' }])
    expect((await service.list(f.thread)).commands.some(command => command.name === 'codex-only')).toBe(false)
    expect(await service.prepare(f.thread, 'Review /api/login')).toEqual({ text: 'Review /api/login' })
  })
  it('keeps native Codex skills and core commands in the Thread protocol', async () => {
    const f = await fixture(), native = nativeFixture(), thread = { ...f.thread, provider: 'codex' as const }
    const service = new ThreadCommandService(() => 'codex', { home: f.home, transport: native.factory })
    const catalog = await service.list(thread)
    expect(catalog.commands.map(command => command.name)).toEqual(expect.arrayContaining(['compact', 'model', 'oxe-plan', 'review', 'status', 'permissions', 'plan', 'plugins', 'fork', 'skills']))
    expect(catalog.commands.every(command => !('path' in command))).toBe(true)
    expect(await service.prepare(thread, '/oxe-plan Review auth')).toEqual({ text: '$oxe-plan Review auth', skill: { name: 'oxe-plan', path: '/native/oxe-plan/SKILL.md' } })
    expect(native.requests.map(request => request.method)).toEqual(['initialize', 'initialized', 'skills/list'])
    expect(native.requests[2].params).toEqual({ cwds: [f.project], forceReload: true })
    expect(native.transports.every(transport => vi.mocked(transport.close).mock.calls.length === 1)).toBe(true)
    for (const command of ['/model', '/status', '/review']) expect(await service.prepare(thread, command)).toEqual({ text: command })
    await expect(service.prepare(thread, '/unknown')).rejects.toThrow('Unknown command')
    await expect(service.prepare(thread, '/compact focus')).rejects.toThrow('does not take arguments')
  })
  it('reports discovery failures without hiding local OXE skills or turning unknown commands into prompts', async () => {
    const f = await fixture(), thread = { ...f.thread, provider: 'codex' as const }
    await f.file(join(f.home, '.oxe/skills/refactor.md'), markdown('refactor', 'Review changes'))
    const service = new ThreadCommandService(() => 'missing', { home: f.home, transport: () => { throw Error('Unavailable CLI') } })
    const catalog = await service.list(thread)
    expect(catalog.commands.map(command => command.name)).toEqual(expect.arrayContaining(['compact', 'model', 'refactor', 'review', 'status', 'permissions']))
    expect(catalog.warning).toContain('Could not load Codex skills')
    expect(await service.prepare(thread, '/refactor Auth')).toEqual({ text: 'Review changes\n\nAuth' })
    await expect(service.prepare(thread, '/unknown')).rejects.toThrow('Unknown command')
  })
  it('shares one native discovery across concurrent queries, reopenings and sends, with explicit refresh', async () => {
    const f = await fixture(), native = claudeFixture()
    const service = new ThreadCommandService(() => 'claude', { home: f.home, claudeTransport: native.factory })
    await Promise.all(Array.from({ length: 20 }, (_, index) => index % 2 ? service.list(f.thread) : service.prepare(f.thread, '/model')))
    expect(native.factory).toHaveBeenCalledTimes(1)
    await service.list({ ...f.thread, id: 'another-thread' })
    expect(native.factory).toHaveBeenCalledTimes(1)
    await service.list(f.thread, true)
    expect(native.factory).toHaveBeenCalledTimes(2)
    expect(native.transports.every(transport => vi.mocked(transport.close).mock.calls.length === 1)).toBe(true)
    await service.stop()
    await expect(service.list(f.thread)).rejects.toThrow('shutting down')
  })
  it('separates catalogs by executable and cwd while reading changed OXE prompts without spawning', async () => {
    const f = await fixture(), native = claudeFixture()
    let executable = 'claude'
    const service = new ThreadCommandService(() => executable, { home: f.home, claudeTransport: native.factory })
    const path = join(f.project, '.oxe/skills/custom.md')
    await f.file(path, markdown('custom', 'First {{argument}}'))
    expect(await service.prepare(f.thread, '/custom input')).toEqual({ text: 'First input' })
    await f.file(path, markdown('custom', 'Edited {{argument}}'))
    expect(await service.prepare(f.thread, '/custom input')).toEqual({ text: 'Edited input' })
    expect(native.factory).toHaveBeenCalledTimes(1)
    executable = 'changed-claude.exe'
    await service.list(f.thread)
    await service.list({ ...f.thread, rootPath: f.home })
    expect(native.factory).toHaveBeenCalledTimes(3)
    await service.stop()
  })
  it('backs off failed discovery instead of repeatedly opening processes, and retries on refresh', async () => {
    const f = await fixture(), factory = vi.fn(() => { throw Error('Unavailable') })
    const service = new ThreadCommandService(() => 'claude', { home: f.home, claudeTransport: factory })
    await Promise.all(Array.from({ length: 10 }, () => service.list(f.thread)))
    await service.prepare(f.thread, '/model')
    expect(factory).toHaveBeenCalledTimes(1)
    expect((await service.list(f.thread, true)).warning).toContain('Refresh commands')
    expect(factory).toHaveBeenCalledTimes(2)
    await service.stop()
  })
  it('retries expired catalogs and failure backoff while sharing refresh calls in flight', async () => {
    const f = await fixture(), native = claudeFixture()
    let now = Date.now(), unavailable = true
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const factory = vi.fn(() => { if (unavailable) throw Error('Unavailable'); return native.factory() })
    const service = new ThreadCommandService(() => 'claude', { home: f.home, claudeTransport: factory })
    try {
      await service.list(f.thread)
      unavailable = false
      now += 4999
      expect((await service.list(f.thread)).warning).toBeDefined()
      expect(factory).toHaveBeenCalledTimes(1)
      now += 2
      expect((await service.list(f.thread)).warning).toBeUndefined()
      expect(factory).toHaveBeenCalledTimes(2)
      now += 60001
      await Promise.all(Array.from({ length: 8 }, () => service.list(f.thread, true)))
      expect(factory).toHaveBeenCalledTimes(3)
    } finally { clock.mockRestore(); await service.stop() }
  })
})
