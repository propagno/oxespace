// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { openInMemoryDatabase } from '../../electron/main/db'
import { MemoryRuntime } from '../../electron/main/services/memory/memory-runtime'
import { AiMemoryProvider } from '../../electron/main/services/memory/ai-memory.provider'
import { AgentMemoryAdapters } from '../../electron/main/services/memory/agent-memory-adapter'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text), decryptString: (value: Buffer) => value.toString() } }))

const oldBinary = process.env.OXESPACE_AI_MEMORY_TEST_BINARY
const newBinary = process.env.OXESPACE_AI_MEMORY_V26_TEST_BINARY
async function directoryDigest(root: string): Promise<string> {
  const hash = createHash('sha256')
  async function visit(dir: string, prefix: string) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${entry.name}`
      if (entry.isDirectory()) await visit(join(dir, entry.name), `${name}/`)
      else {
        expect(entry.isFile()).toBe(true)
        hash.update(name); hash.update(await readFile(join(dir, entry.name)))
      }
    }
  }
  await visit(root, '')
  return hash.digest('hex')
}
test.skipIf(!oldBinary || !newBinary)('upgrades a stopped native 2.1.0 store and rolls back to its complete snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oxe-memory-native-upgrade-'))
  const db = openInMemoryDatabase()
  const runtime = new MemoryRuntime(db, join(directory, 'runtime'))
  const port = await new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const address = server.address() as { port: number }; server.close(() => resolvePort(address.port)) })
  })
  const old = { mode: 'managed' as const, executable: oldBinary!, url: `http://127.0.0.1:${port}` }
  const next = { ...old, executable: newBinary! }
  const cwd = join(directory, 'project')
  const context = { projectId: 'upgrade', workspace: 'synthetic', project: 'upgrade', cwd }
  try {
    await mkdir(cwd)
    await writeFile(join(cwd, '.ai-memory.toml'), 'workspace = "synthetic"\nproject = "upgrade"\n')
    await runtime.configure(old)
    await runtime.start()
    const provider = new AiMemoryProvider(runtime.client())
    await provider.remember(context, { title: 'baseline', text: 'SyntheticUpgradeMarker: preserve this verified decision.' })
    expect(JSON.stringify(await provider.search(context, 'SyntheticUpgradeMarker'))).toContain('SyntheticUpgradeMarker')
    await runtime.stop()
    const originalDigest = await directoryDigest(runtime.dataDir)
    const originalToken = await readFile(join(runtime.dataDir, 'auth-token'), 'utf8')
    await runtime.configure(next)
    expect(runtime.settings()).toEqual(next)
    expect(await readFile(join(runtime.dataDir, 'auth-token'), 'utf8')).toBe(originalToken)
    await runtime.start()
    expect(JSON.stringify(await new AiMemoryProvider(runtime.client()).search(context, 'SyntheticUpgradeMarker'))).toContain('SyntheticUpgradeMarker')
    const config = await readFile(runtime.configPath, 'utf8')
    expect(config).toContain('[profile]\nenabled = false')
    expect(config).toContain('[handoff]\nclaim_on_session_start = false')
    const hookPath = join(directory, 'synthetic-hooks.json')
    const adapters = new AgentMemoryAdapters(runtime, [{ agent: 'codex', hooks: () => hookPath }])
    await adapters.setup()
    const firstHooks = await readFile(hookPath, 'utf8')
    await adapters.setup()
    expect(await readFile(hookPath, 'utf8')).toBe(firstHooks)
    await runtime.configure(old)
    expect(runtime.settings()).toEqual(old)
    expect(await directoryDigest(runtime.dataDir)).toBe(originalDigest)
    expect(await readFile(join(runtime.dataDir, 'auth-token'), 'utf8')).toBe(originalToken)
    await runtime.start()
    expect(JSON.stringify(await new AiMemoryProvider(runtime.client()).search(context, 'SyntheticUpgradeMarker'))).toContain('SyntheticUpgradeMarker')
    await adapters.setup()
    expect((await readFile(hookPath, 'utf8'))).toContain('oxespace-memory-hook.cjs')
  } finally {
    await runtime.stop()
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 90_000)
