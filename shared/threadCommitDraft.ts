/**
 * A commit message and pull request drafted from a conversation: what was
 * asked in the turns that changed files, and which files they changed. A
 * starting point the person edits, never committed without them.
 */
import type { ThreadSnapshot } from './types/thread'
import { turnVerdict } from './threadTurnVerdict'

export interface ThreadCommitDraft { message: string; prTitle: string; prBody: string }

const MAX_ITEMS = 10
const firstLine = (text: string, limit: number): string => {
  const line = text.split('\n').map(value => value.trim()).find(Boolean) ?? ''
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line
}

export function threadCommitDraft(snapshot: Pick<ThreadSnapshot, 'events' | 'turns' | 'thread'>): ThreadCommitDraft {
  const asks: string[] = []
  const files = new Set<string>()
  for (const turn of snapshot.turns ?? []) {
    const verdict = turnVerdict(snapshot, turn.id)
    if (!verdict?.filesChanged.length) continue
    verdict.filesChanged.forEach(file => files.add(file))
    const prompt = snapshot.events.find(event => event.type === 'message' && event.role === 'user' && event.id === turn.id)
    const ask = prompt?.type === 'message' ? firstLine(prompt.text, 100) : ''
    if (ask && !asks.includes(ask)) asks.push(ask)
  }
  const subject = firstLine(snapshot.thread.title, 72) || asks[0] || 'Update project files'
  const bullets = asks.slice(0, MAX_ITEMS).map(ask => `- ${ask}`)
  const fileList = [...files].sort()
  const message = bullets.length > 1 || (bullets.length === 1 && asks[0] !== subject) ? `${subject}\n\n${bullets.join('\n')}` : subject
  const prBody = [
    '## Summary', '', ...(bullets.length ? bullets : ['- ' + subject]), '',
    '## Files changed', '', ...(fileList.length ? fileList.slice(0, 50).map(file => `- \`${file}\``) : ['- (none recorded)']),
    ...(fileList.length > 50 ? [`- …and ${fileList.length - 50} more`] : []), '',
    '_Drafted from an OxeChat conversation in OXESpace._'
  ].join('\n')
  return { message, prTitle: subject, prBody }
}
