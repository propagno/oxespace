// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { afterEach, describe, expect, it } from 'vitest'
import { NativeHistoryWorkerClient } from '../electron/main/services/conversation/native-history-worker-client'
import type { ConversationThread } from '../shared/types/thread'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes('oxe-history-worker-')) throw Error('Unsafe fixture cleanup')
    await rm(root, { recursive: true, force: true })
  }
})

describe('native history worker', () => {
  it('reads provider pages outside the main thread and shuts down deterministically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-history-worker-')); roots.push(root)
    const script = join(root, 'reader.mjs')
    await build({ entryPoints: [resolve('electron/main/workers/native-history-worker.ts')], outfile: script, bundle: true, platform: 'node', format: 'esm', packages: 'external' })
    // Worker gets a synthetic provider home, never a user's native session.
    const wrapper = join(root, 'entry.mjs')
    const home = join(root, 'claude')
    await writeFile(wrapper, `process.env.CLAUDE_CONFIG_DIR=${JSON.stringify(home)}; await import('./reader.mjs');`)
    const thread = { provider: 'claude', rootPath: join(root, 'repo') } as ConversationThread
    const folder = join(home, 'projects', thread.rootPath.replace(/[^a-zA-Z0-9]/g, '-'))
    await mkdir(folder, { recursive: true })
    const id = '11111111-1111-4111-8111-111111111111'
    await writeFile(join(folder, `${id}.jsonl`), Array.from({ length: 1200 }, (_, index) => JSON.stringify({ sessionId: id, cwd: thread.rootPath, type: 'user', uuid: `message-${index}`, parentUuid: index ? `message-${index - 1}` : null, message: { content: `Question ${index}` } })).join('\n'))
    const client = new NativeHistoryWorkerClient(wrapper, () => 'unused')
    try {
      const first = await client.read(thread, id)
      expect(first.events).toHaveLength(1000)
      expect(first.cursor?.claudeParent).toBe('message-199')
      const second = await client.read(thread, id, first.cursor)
      expect(second.events).toHaveLength(200)
      expect(second.events[0]).toMatchObject({ text: 'Question 0' })
      expect(second.cursor).toBeUndefined()
      await expect(client.read(thread, '../invalid')).rejects.toThrow('identifier')
    } finally { await client.close() }
    await expect(client.read(thread, id)).rejects.toThrow('shutting down')
  })
  it('rejects pending work on shutdown instead of leaving the caller waiting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-history-worker-')); roots.push(root)
    const script = join(root, 'silent.mjs')
    await writeFile(script, "import {parentPort} from 'node:worker_threads'; parentPort.on('message',()=>{});")
    const client = new NativeHistoryWorkerClient(script, () => 'unused')
    const result = client.read({ provider: 'codex', rootPath: root } as ConversationThread, 'session')
    const rejection = expect(result).rejects.toThrow('closed')
    await client.close()
    await rejection
  })
  it('recovers with a fresh worker after a crash without replaying the failed request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-history-worker-')); roots.push(root)
    const script = join(root, 'crash.mjs')
    await writeFile(script, "import {parentPort} from 'node:worker_threads'; parentPort.on('message',()=>process.exit(1));")
    const client = new NativeHistoryWorkerClient(script, () => 'unused')
    const thread = { provider: 'codex', rootPath: root } as ConversationThread
    try {
      await expect(client.read(thread, 'first')).rejects.toThrow('exited')
      await writeFile(script, "import {parentPort} from 'node:worker_threads'; parentPort.on('message',({requestId,id})=>parentPort.postMessage({requestId,result:{events:[],title:id}}));")
      await expect(client.read(thread, 'explicit-retry')).resolves.toEqual({ events: [], title: 'explicit-retry' })
    } finally { await client.close() }
  })
})
