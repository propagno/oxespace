import type { ThreadArtifact, ThreadSnapshot } from '../../../../shared/types/thread'
import { diagnosticText } from './thread-failure'

const MAX_EXPORT_BYTES = 2 * 1024 * 1024

/** Builds inert, redacted evidence without invoking provider commands or tools. */
export class ThreadExportService {
  constructor(private readonly artifact: (threadId: string, artifactId: string) => ThreadArtifact) {}

  markdown(snapshot: ThreadSnapshot): string {
    const safe = (value: unknown) => diagnosticText(typeof value === 'string' ? value : JSON.stringify(value))
    const lines = [`# ${safe(snapshot.thread.title) || 'Conversation'}`, '',
      `- Thread ID: \`${snapshot.thread.id}\``, `- Native session: \`${snapshot.thread.nativeSessionId ?? 'not started'}\``,
      `- Provider: \`${snapshot.thread.provider}\``, `- Directory: \`${safe(snapshot.thread.rootPath)}\``,
      `- Model: \`${safe(snapshot.thread.model ?? 'provider default')}\``, `- Effort: \`${safe(snapshot.thread.reasoningEffort ?? 'automatic')}\``, '']
    if (snapshot.thread.nativeHistoryCursor) lines.push('_Earlier native messages have not been loaded; this export contains imported history only._', '')
    for (const event of snapshot.events) {
      if (event.type === 'message') {
        lines.push(`## ${event.role === 'user' ? 'You' : snapshot.thread.provider === 'codex' ? 'Codex' : 'Claude'}`, '', safe(event.text), '')
        if (event.historicalQuestions?.length) {
          lines.push('### Recovered questions — answer not confirmed', '')
          for (const question of event.historicalQuestions) lines.push(safe(question.title), ...(question.options ?? []).map(option => `- ${safe(option)}`), '')
        }
      }
      else if (event.type === 'tool') {
        lines.push(`### Tool · ${safe(event.name)} · ${event.state}`, '', safe(event.detail))
        if (event.output) lines.push('', '```text', safe(event.output), '```')
        for (const file of event.files ?? []) {
          lines.push('', `- ${file.kind}: \`${safe(file.path)}\`${file.artifactId ? ` · evidence \`${file.artifactId}\`` : ' · evidence unavailable'}`)
          if (file.artifactId) {
            try { lines.push('', '```diff', safe(this.artifact(snapshot.thread.id, file.artifactId).content), '```') }
            catch { lines.push('', '_Stored evidence is unavailable._') }
          }
        }
        lines.push('')
      } else if (event.type === 'subagent') {
        lines.push(`### Agent · ${safe(event.action)} · ${event.state}`, '')
        if (event.model) lines.push(`- Model: \`${safe(event.model)}\``)
        if (event.reasoningEffort) lines.push(`- Effort: \`${safe(event.reasoningEffort)}\``)
        for (const agent of event.agents) lines.push(`- \`${safe(agent.threadId)}\`: ${agent.status}${agent.message ? ` — ${safe(agent.message)}` : ''}`)
        if (event.prompt) lines.push('', safe(event.prompt))
        lines.push('')
      } else if (event.type === 'turn-diff') {
        lines.push(`### Verified turn changes · ${safe(event.turnId)}`, '')
        for (const file of event.files) lines.push(`- ${file.kind}: \`${safe(file.path)}\`${file.artifactId ? ` · evidence \`${file.artifactId}\`` : ' · evidence unavailable'}`)
        lines.push('')
      } else if (event.type === 'request') lines.push(`### Request · ${safe(event.request.title)} · ${event.request.state}`, '', ...(event.request.questions ?? []).map(question => `- ${safe(question.question)}`), '')
      else if (event.type === 'plan') lines.push('### Plan', '', ...event.steps.map(step => `- [${step.status === 'completed' ? 'x' : ' '}] ${safe(step.label)} (${step.status})`), '')
      else if (event.type === 'completed') lines.push(`### Turn ${event.status}`, ...(event.failure ? ['', `${safe(event.failure.message)}${event.failure.detail ? `\n\n${safe(event.failure.detail)}` : ''}`] : []), '')
    }
    const output = lines.join('\n')
    return output.length > MAX_EXPORT_BYTES ? `${output.slice(0, MAX_EXPORT_BYTES)}\n\n_Export truncated at 2 MiB._\n` : output
  }
}
