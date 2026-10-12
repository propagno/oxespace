// Isolated native inference; deliberately drops one completion notification.
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { StringDecoder } from 'node:string_decoder'
const directory = await mkdtemp(join(tmpdir(), 'oxe-live-recovery-'))
const modulePath = join(directory, 'probe.cjs')
await build({ stdin: { contents: `export { CodexConversationAdapter } from './electron/main/services/conversation/codex-conversation'; export { CodexStateReader } from './electron/main/services/conversation/codex-state-reader'; export { AgentProcessTransport } from './electron/main/services/conversation/process-transport';`, resolveDir: process.cwd() }, outfile: modulePath, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const { CodexConversationAdapter, CodexStateReader, AgentProcessTransport } = createRequire(import.meta.url)(modulePath)
const transport = new AgentProcessTransport('codex', ['app-server', '--listen', 'stdio://'], directory)
let dropped = false, nativeId, turnId, completed = 0, sends = 0
const write = transport.write.bind(transport)
transport.write = line => { if (JSON.parse(line).method === 'turn/start') sends++; write(line) }
const onData = transport.onData.bind(transport)
transport.onData = listener => {
  let buffer = ''
  const decoder = new StringDecoder('utf8')
  onData(chunk => {
    buffer += decoder.write(Buffer.from(chunk))
    let end
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
      if (!line.trim()) continue
      if (!dropped && JSON.parse(line).method === 'turn/completed') { dropped = true; continue }
      listener(Buffer.from(line + '\n'))
    }
  })
}
const adapter = new CodexConversationAdapter(transport)
const reader = new CodexStateReader(() => 'codex')
const waitFor = async predicate => {
  const end = Date.now() + 60000
  while (!predicate()) { if (Date.now() > end) throw Error('Probe deadline exceeded'); await new Promise(resolve => setTimeout(resolve, 250)) }
}
const report = { capturedAt: new Date().toISOString(), isolated: true, installedApplication: false, inference: true }
try {
  await adapter.start({ rootPath: directory, nativeSessionId: null, access: 'read-only', model: 'gpt-6-luna', reasoningEffort: 'low' }, event => {
    if (event.type === 'session') nativeId = event.nativeSessionId
    if (event.type === 'turn-accepted') turnId = event.nativeTurnId
    if (event.type === 'completed') completed++
  })
  await adapter.send('Reply only OK. Do not use tools.')
  await waitFor(() => dropped)
  const observed = await adapter.observe(turnId)
  const recovered = await reader.recover({ provider: 'codex', nativeSessionId: nativeId, rootPath: directory }, turnId)
  const confirmed = await adapter.observe(turnId)
  let committed = false
  const released = recovered.recoveredMessages !== undefined && recovered.state === confirmed.state && adapter.commitRecoveredTurn(turnId, recovered.state, () => { committed = true })
  Object.assign(report, { observed: observed.state, recovered: recovered.state, messages: recovered.recoveredMessages?.length ?? 0, released, committed, droppedTerminal: dropped, prematureCompletions: completed, sendsBeforeExplicitNext: sends })
  if (!released) throw Error('Live recovery did not release the isolated turn')
  await adapter.send('Reply only OK again. Do not use tools.')
  await waitFor(() => completed === 1)
  Object.assign(report, { explicitNextCompleted: true, sends })
} catch (error) { report.error = error instanceof Error ? error.message : 'Probe failed'; process.exitCode = 1 }
finally {
  await adapter.dispose(); await reader.stop()
  await writeFile(new URL('./native-live-recovery-probe.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
