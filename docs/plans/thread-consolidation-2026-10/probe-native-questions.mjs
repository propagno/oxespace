// Isolated native question roundtrip. No existing session is resumed.
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const provider = process.argv[2]
const approval = process.argv[3] === 'approval'
if (!['codex', 'claude'].includes(provider)) throw Error('Expected codex or claude')
const directory = await mkdtemp(join(tmpdir(), 'oxe-native-question-'))
const modulePath = join(directory, 'probe.cjs')
await build({ stdin: { contents: `export { CodexConversationAdapter } from './electron/main/services/conversation/codex-conversation'; export { ClaudeConversationAdapter } from './electron/main/services/conversation/claude-conversation'; export { AgentProcessTransport } from './electron/main/services/conversation/process-transport';`, resolveDir: process.cwd() }, outfile: modulePath, bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const { CodexConversationAdapter, ClaudeConversationAdapter, AgentProcessTransport } = createRequire(import.meta.url)(modulePath)
const adapter = provider === 'codex' ? new CodexConversationAdapter(new AgentProcessTransport('codex', ['app-server', '--listen', 'stdio://'], directory)) : new ClaudeConversationAdapter((args, cwd) => new AgentProcessTransport('claude', args, cwd))
const report = { capturedAt: new Date().toISOString(), provider, scenario: approval ? 'approval-decline' : 'question-answer', isolated: true, installedApplication: false, inference: true, questions: 0, options: 0, responsesSent: 0, approvalsDeclined: 0, requestResolved: false }
let terminal = false
const pending = []
try {
  await adapter.start({ rootPath: directory, nativeSessionId: null, access: 'read-only', approvalPolicy: 'on-request', mode: approval ? 'default' : 'plan', ...(provider === 'codex' ? { model: 'gpt-6-luna', reasoningEffort: 'low' } : {}) }, event => {
    if (event.type === 'request') {
      if (event.request.kind === 'question') {
        report.questions += event.request.questions?.length ?? 0
        report.options += event.request.questions?.reduce((sum, question) => sum + (question.options?.length ?? 0), 0) ?? 0
        const answers = Object.fromEntries((event.request.questions ?? []).map(question => [question.id, [question.options?.[0]?.value ?? question.options?.[0]?.label ?? 'Alpha']]))
        pending.push(adapter.respondRequest(event.id, { answers }).then(() => { report.responsesSent++ }).catch(() => { report.responseError = true }))
      } else pending.push(adapter.respondRequest(event.id, { decision: 'decline' }).then(() => { report.approvalsDeclined++ }).catch(() => { report.responseError = true }))
    }
    if (event.type === 'request-resolved' && event.resolution === (approval ? 'declined' : 'answered')) report.requestResolved = true
    if (event.type === 'completed') { terminal = true; report.status = event.status; if (event.errorCode) report.errorCode = event.errorCode }
  })
  await adapter.send(approval ? 'This is an isolated approval UI validation. Request approval to execute the harmless shell command Write-Output OXE_APPROVAL_TEST using sandbox_permissions require_escalated with a short justification. Do not run anything without that approval. If declined, reply only DECLINED and stop; do not retry or use an alternative command. Do not read or modify files, access the network, or use MCPs.' : 'This is an isolated interface validation. Use your structured user-question tool to ask me to choose between Alpha and Beta. Ask exactly one question with those two options. After I answer, reply only OK. Do not read files, run commands, use MCPs, or make changes. Do not write the question as ordinary text.')
  const deadline = Date.now() + 60000
  while (!terminal && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250))
  if (!terminal) { report.status = 'deadline'; await adapter.interrupt().catch(() => {}) }
  await Promise.allSettled(pending)
  report.passed = report.status === 'completed' && report.requestResolved && (approval ? report.approvalsDeclined === 1 : report.questions === 1 && report.options >= 2 && report.responsesSent === 1)
} catch (error) { report.error = error instanceof Error ? error.message : 'Probe failed'; report.passed = false }
finally {
  await adapter.dispose()
  await writeFile(new URL(`./native-${provider}-${approval ? 'approval' : 'questions'}-probe.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
