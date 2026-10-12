// Read-only native protocol probe. No inference or resume.
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
const [sessionId, turnId, directory, output, mode] = process.argv.slice(2)
if (!sessionId || !turnId || !directory || !output) throw Error('Expected session ID, turn ID, directory, report path')
const temporary = await mkdtemp(join(tmpdir(), 'oxe-passive-state-probe-'))
const modulePath = join(temporary, 'probe.cjs')
await build({ stdin: { contents: `export { CodexStateReader } from './electron/main/services/conversation/codex-state-reader'; export { AgentProcessTransport } from './electron/main/services/conversation/process-transport';`, resolveDir: process.cwd() }, outfile: modulePath, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const { CodexStateReader, AgentProcessTransport } = createRequire(import.meta.url)(modulePath)
const methods = []
const reader = new CodexStateReader(() => 'codex', (command, cwd) => {
  const transport = new AgentProcessTransport(command, ['app-server', '--listen', 'stdio://'], cwd)
  const write = transport.write.bind(transport)
  transport.write = line => {
    const request = JSON.parse(line)
    if (request.method) {
      if (!['initialize', 'initialized', 'thread/read', 'thread/turns/list', 'thread/items/list'].includes(request.method)) throw Error('Mutation forbidden in passive probe')
      methods.push(request.method)
    }
    write(line)
  }
  return transport
})
try {
  const start = performance.now()
  const { recoveredMessages, recoveredItems, ...observation } = await reader[mode === 'recover' ? 'recover' : 'observe']({ provider: 'codex', nativeSessionId: sessionId, rootPath: resolve(directory) }, turnId)
  const report = { capturedAt: new Date().toISOString(), elapsedMs: performance.now() - start, inference: false, resumed: false, installedApplication: false, methods, observation,
    ...(mode === 'recover' ? { recovered: recoveredMessages !== undefined, messages: recoveredMessages?.length ?? 0, tools: recoveredItems?.filter(item => item.type === 'tool').length ?? 0, textBytes: recoveredMessages?.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0) ?? 0 } : {}) }
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally { await reader.stop() }
