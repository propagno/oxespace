import type { ConversationThread } from '../../../shared/types/thread'
import type { ComposerHintStatus } from './composerModel'

export type ThreadComposerState = 'disabled' | 'idle' | 'sending' | 'running' | 'approval' | 'reconnecting' | 'queued' | 'unknown'

export function deriveThreadComposerState(thread: ConversationThread | undefined, pending: boolean): ThreadComposerState {
  if (!thread || thread.cliActive) return 'disabled'
  if (pending) return 'sending'
  if (thread.status === 'approval') return 'approval'
  if (thread.connection?.state === 'degraded' || thread.connection?.state === 'reconnecting') return 'reconnecting'
  if (thread.queue?.some(item => item.state === 'unknown')) return 'unknown'
  if (thread.queue?.some(item => item.state === 'queued' || item.state === 'sending')) return 'queued'
  if (thread.status === 'running') return 'running'
  return 'idle'
}

export function deriveComposerHintStatus(thread: ConversationThread | undefined, running: boolean, hasPendingRequests = false): ComposerHintStatus {
  if (thread?.status === 'approval' || hasPendingRequests) return 'needs-you'
  if (running || thread?.status === 'running') return 'working'
  return 'idle'
}

/** Text as a Markdown block quote, bounded so a long reply does not flood the composer. */
export function quoteMarkdown(text: string, limit = 2000): string {
  const body = text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text
  return body.split('\n').map(line => line ? `> ${line}` : '>').join('\n') + '\n\n'
}
