import { Check, ChevronDown, CircleAlert, Loader2, TerminalSquare } from 'lucide-react'
import type { ThreadEvent } from '../../../shared/types/thread'
type Tool = Extract<ThreadEvent, { type: 'tool' }>
const names: Record<string, string> = { commandExecution: 'Ran command', fileChange: 'Changed files', mcpToolCall: 'Used integration', contextCompaction: 'Compacted context', Read: 'Read file', Glob: 'Found files', Grep: 'Searched code', Bash: 'Ran command', Edit: 'Edited file', Write: 'Wrote file', 'Tool result': 'Completed action' }

function diagnosticKind(event: Tool): { label: string; className: string } {
  const text = `${event.detail}\n${event.output ?? ''}`
  if (/not reachable|unavailable after \d+ attempts|request timed out|ECONN(?:REFUSED|RESET)|outcome=infrastructure/i.test(text)) return { label: 'Infrastructure unavailable', className: 'is-infrastructure' }
  if (/Quality Controller|outcome=validation|verdict=(?:PASS|WARN|FAIL)/i.test(text)) return { label: 'Validation result', className: event.state === 'failed' || /verdict=FAIL/i.test(text) ? 'is-validation-warning' : 'is-validation' }
  return { label: event.state === 'failed' ? 'Action failed' : event.state === 'running' ? 'In progress' : 'Completed', className: event.state === 'failed' ? 'is-failure' : '' }
}

function ThreadToolDiagnostic({ event }: { event: Tool }) {
  const kind = diagnosticKind(event)
  const detail = event.detail.trim(), output = event.output?.trim() ?? ''
  const technical = [detail && `Input\n${detail}`, output && `Output\n${output}`, event.exitCode !== undefined && `Exit code ${event.exitCode}`].filter(Boolean).join('\n\n')
  const primary = (output || detail || kind.label).split('\n').find(Boolean) ?? kind.label
  const verbose = technical.length > 800 || technical.split('\n').length > 8
  return <div className="thread-tool-diagnostic">
    <div className="thread-tool-diagnostic-meta"><span className={kind.className}>{kind.label}</span>{event.startedAt && event.completedAt && <time>{Math.max(0, event.completedAt - event.startedAt)} ms</time>}</div>
    {verbose ? <><p>{primary.slice(0, 320)}</p><details className="thread-tool-technical"><summary>Technical details</summary><pre>{technical}</pre></details></>
      : technical && <pre>{technical}</pre>}
  </div>
}

export function ThreadActivityGroup({ events }: { events: Tool[] }) {
  const running = events.some(event => event.state === 'running'), failures = events.filter(event => event.state === 'failed').length
  const commands = events.every(event => ['commandExecution', 'Bash'].includes(event.name))
  const reading = events.every(event => ['Read', 'Glob', 'Grep'].includes(event.name))
  if (events.length === 1) {
    const event = events[0]
    return <details className={`thread-activity-single${event.state === 'failed' ? ' has-failure' : ''}`}>
      <summary>{event.state === 'running' ? <Loader2 size={14} className="thread-spin" /> : event.state === 'failed' ? <CircleAlert size={14} /> : <TerminalSquare size={14} />}
        <span>{names[event.name] ?? event.name}<small>{event.detail.split('\n')[0]?.slice(0, 140)}</small></span><ChevronDown size={13} /></summary>
      <ThreadToolDiagnostic event={event} />
    </details>
  }
  return <details className={`thread-activity-group${failures ? ' has-failure' : ''}`}>
    <summary>{running ? <Loader2 size={14} className="thread-spin" /> : failures ? <CircleAlert size={14} /> : <Check size={14} />}<span>{running ? 'Working' : commands ? 'Ran commands' : reading ? 'Explored the project' : failures ? 'Actions need attention' : 'Completed actions'}<small> · {events.length} {events.length === 1 ? 'action' : 'actions'}{failures ? ` · ${failures} failed` : ''}</small></span><ChevronDown size={13} /></summary>
    <div className="thread-activity-items">{events.map(event => <details key={event.id} className="thread-activity-item">
      <summary><TerminalSquare size={13} /><span>{names[event.name] ?? event.name}<small>{event.detail.split('\n')[0]?.slice(0, 120)}</small></span><span className="thread-activity-state">{event.state === 'running' ? 'Running' : event.state === 'failed' ? 'Failed' : 'Done'}</span></summary>
      <ThreadToolDiagnostic event={event} />
    </details>)}</div>
  </details>
}

export function groupThreadEvents(events: ThreadEvent[]): (ThreadEvent | { type: 'activity-group'; id: string; events: Tool[] })[] {
  const blocks: ReturnType<typeof groupThreadEvents> = []
  for (const event of events) {
    const previous = blocks.at(-1)
    if (event.type === 'tool' && !event.files?.length) {
      if (previous?.type === 'activity-group' && previous.events.at(-1)?.turnId === event.turnId) previous.events.push(event)
      else blocks.push({ type: 'activity-group', id: event.id, events: [event] })
    } else blocks.push(event)
  }
  return blocks
}
