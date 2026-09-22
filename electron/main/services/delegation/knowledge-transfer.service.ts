import { createHash } from 'node:crypto'
import type { DelegationTask, KnowledgeTransferBundle, KnowledgeTransferSource } from '../../../../shared/types/delegation'

const MAX_CONTEXT_BYTES = 24 * 1024
export interface DelegationEnrichment { memory?: string; code?: string }
const SECRET_PATTERNS = [
  /\b(?:sk|rk|pk)-(?:live|test|proj)-[a-z0-9_-]{12,}\b/gi,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
]

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
function redact(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value.replace(/\0/g, ''))
}
function truncateUtf8(value: string, maximum: number): string {
  const bytes = Buffer.from(value)
  if (bytes.length <= maximum) return value
  let end = Math.max(0, maximum)
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8')
}

export class KnowledgeTransferService {
  build(task: DelegationTask, enrichment: string | DelegationEnrichment): KnowledgeTransferBundle {
    const sections: Array<{ kind: KnowledgeTransferSource['kind']; label: string; text: string; maxBytes: number }> = [
      { kind: 'handoff', label: 'Origin handoff', text: redact(task.handoff), maxBytes: 6000 },
      { kind: 'acceptance', label: 'Acceptance criteria', text: redact(task.acceptance), maxBytes: 2000 }
    ]
    if (task.lastReport) sections.splice(0, 0, { kind: 'checkpoint', label: 'Latest confirmed progress and next steps', text: redact(task.lastReport), maxBytes: 1000 })
    if (typeof enrichment === 'string') {
      if (enrichment.trim()) sections.push({ kind: 'memory', label: 'Optional historical context', text: redact(enrichment), maxBytes: 3000 })
    } else if (enrichment.memory?.trim()) sections.push({ kind: 'memory', label: 'AI Memory', text: redact(enrichment.memory), maxBytes: 3000 })
    const sessionBytes = Math.min(3000, Math.floor(5000 / Math.max(1, task.sessionContext?.length ?? 0)))
    for (const session of task.sessionContext ?? []) sections.push({
      kind: 'session', label: `Conversation ${session.title} (${session.provider}, ${session.threadId}, captured ${new Date(session.capturedAt).toISOString()})`,
      text: redact(session.text), maxBytes: sessionBytes
    })
    for (const evidence of task.evidence ?? []) sections.push({
      kind: 'evidence', label: `${evidence.path}@${evidence.commit.slice(0, 12)}`, text: redact(evidence.text), maxBytes: 1000
    })
    if (typeof enrichment !== 'string' && enrichment.code?.trim()) sections.push({ kind: 'code', label: 'CodeGraph', text: redact(enrichment.code), maxBytes: 1500 })

    const header = [
      `Task: ${truncateUtf8(redact(task.objective), 2000)}`,
      `Mode: ${task.mode ?? 'isolated-change'}${task.mode === 'analysis' ? ' — analyze and report; do not change repository files. This is an instruction, not an OS sandbox.' : ''}`,
      `Branch: ${task.branch}`,
      `Base: ${task.checkout?.baseRef ?? task.baseSha} (${task.baseSha})`,
      `Checkout: ${task.path}`,
      '',
      'Verify every historical claim against the checkout. Do not infer uncommitted file contents from this bundle.',
      `Uncommitted source paths not copied: ${truncateUtf8(task.localChanges || 'None', 2048)}`
    ].join('\n')
    let remaining = MAX_CONTEXT_BYTES - Buffer.byteLength(header)
    const included: string[] = []
    const sources: KnowledgeTransferSource[] = []
    for (const section of sections) {
      if (remaining <= 0) break
      const prefix = `\n\n## ${section.label}\n`
      const maximum = Math.max(0, remaining - Buffer.byteLength(prefix))
      const text = truncateUtf8(section.text, Math.min(maximum, section.maxBytes))
      if (!text) continue
      included.push(prefix + text)
      const bytes = Buffer.byteLength(text)
      sources.push({ kind: section.kind, label: section.label, sha256: sha256(text), bytes })
      remaining -= Buffer.byteLength(prefix) + bytes
    }
    const context = header + included.join('')
    const createdAt = Date.now()
    const revision = (task.knowledgeBundle?.revision ?? 0) + 1
    return { version: 1, revision, objective: redact(task.objective), acceptance: redact(task.acceptance),
      handoff: redact(task.handoff), context, sources, createdAt, sha256: sha256(context) }
  }
}
