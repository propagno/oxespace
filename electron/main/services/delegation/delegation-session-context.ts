import type { AppDatabase } from '../../db'
import type { DelegationSessionContext } from '../../../../shared/types/delegation'
import type { ConversationThread, ThreadEvent } from '../../../../shared/types/thread'
import { projectIdentity } from '../memory/memory-project.service'
import { ThreadHistory } from '../conversation/thread-history'

const MAX_MESSAGES = 12
const MAX_SESSION_BYTES = 3 * 1024

function truncate(value: string, limit: number): string {
  const clean = value.replace(/\0/g, '')
  const bytes = Buffer.from(clean)
  if (bytes.length <= limit) return clean
  let end = Math.max(0, limit - 3)
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return `${bytes.subarray(0, end).toString('utf8')}…`
}

/** Capture only visible user/assistant messages; tools, deltas, approvals and attachments stay behind. */
export async function captureDelegationSessions(db: AppDatabase, ids: string[], originProject: string): Promise<DelegationSessionContext[]> {
  const history = new ThreadHistory(db)
  const snapshots: DelegationSessionContext[] = []
  for (const id of ids) {
    const row = db.prepare('SELECT data_json FROM conversation_threads WHERE id = ?').get(id) as { data_json: string } | undefined
    if (!row) throw new Error('Selected conversation was not found')
    const thread = JSON.parse(row.data_json) as ConversationThread
    if (await projectIdentity(thread.rootPath) !== originProject) throw new Error('Selected conversation belongs to another project')
    // Migrate legacy event JSON before querying the indexed journal.
    history.readWindow(id, 1)
    const rows = db.prepare("SELECT data_json FROM conversation_events WHERE thread_id = ? AND json_extract(data_json, '$.type') = 'message' ORDER BY seq DESC LIMIT ?")
      .all(id, MAX_MESSAGES) as { data_json: string }[]
    const messages = rows.reverse().map(row => JSON.parse(row.data_json) as ThreadEvent)
      .filter((event): event is Extract<ThreadEvent, { type: 'message' }> => event.type === 'message' && (event.role === 'user' || event.role === 'assistant'))
    let remaining = MAX_SESSION_BYTES
    const lines: string[] = []
    for (const event of messages.reverse()) {
      const prefix = event.role === 'user' ? 'User: ' : 'Assistant: '
      if (remaining <= Buffer.byteLength(prefix) + 8) break
      const text = truncate(event.text, Math.min(1000, remaining - Buffer.byteLength(prefix)))
      lines.unshift(prefix + text)
      remaining -= Buffer.byteLength(prefix + text + '\n')
    }
    snapshots.push({ threadId: id, title: thread.title.slice(0, 120), provider: thread.provider,
      capturedAt: Date.now(), text: lines.join('\n') || 'No public messages were recorded in this conversation.' })
  }
  return snapshots
}
