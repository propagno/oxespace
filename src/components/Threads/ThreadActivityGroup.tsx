import { threadToolSummary as toolSummary } from '../../../shared/threadToolSummary'
import { threadActionFailure } from '../../../shared/threadActionFailure'
import { Check, ChevronDown, CircleAlert, CircleHelp, Loader2, TerminalSquare } from 'lucide-react'
import type { ThreadEvent } from '../../../shared/types/thread'
type Tool = Extract<ThreadEvent, { type: 'tool' }>
const names: Record<string, string> = { commandExecution: 'Ran command', fileChange: 'Changed files', mcpToolCall: 'Used integration', contextCompaction: 'Compacted context', Read: 'Read file', Glob: 'Found files', Grep: 'Searched code', Bash: 'Ran command', Edit: 'Edited file', Write: 'Wrote file', 'Tool result': 'Completed action' }


function diagnosticKind(event: Tool): { label: string; className: string } {
  const text = `${event.detail}\n${event.output ?? ''}`
  if (/not reachable|unavailable after \d+ attempts|request timed out|ECONN(?:REFUSED|RESET)|outcome=infrastructure/i.test(text)) return { label: 'Infrastructure unavailable', className: 'is-infrastructure' }
  if (/Quality Controller|outcome=validation|verdict=(?:PASS|WARN|FAIL)/i.test(text)) return { label: 'Validation result', className: event.state === 'failed' || /verdict=FAIL/i.test(text) ? 'is-validation-warning' : 'is-validation' }
  return { label: event.state === 'failed' ? 'Action failed' : event.state === 'running' ? 'In progress' : event.state === 'unknown' ? 'Result unconfirmed' : 'Completed', className: event.state === 'failed' ? 'is-failure' : event.state === 'unknown' ? 'is-unconfirmed' : '' }
}

function ThreadToolDiagnostic({ event, onDiagnostics }: { event: Tool; onDiagnostics?: () => void }) {
  const kind = diagnosticKind(event)
  const failure = event.state === 'failed' ? threadActionFailure(event.output ?? '') : undefined
  const detail = event.detail.trim(), output = event.output?.trim() ?? ''
  const technical = [detail && `Input\n${detail}`, output && `Output\n${output}`, event.exitCode !== undefined && `Exit code ${event.exitCode}`].filter(Boolean).join('\n\n')
  const primary = event.state === 'failed'
    ? output.split('\n').find(line => line.trim()) || `The action failed${event.exitCode !== undefined ? ` (exit code ${event.exitCode})` : ''}.`
    : event.state === 'unknown' ? 'The agent did not confirm whether this action finished.'
      : toolSummary(event) || output.split('\n').find(Boolean) || kind.label
  return <div className="thread-tool-diagnostic">
    <div className="thread-tool-diagnostic-meta"><span className={kind.className}>{failure?.label ?? kind.label}</span>{event.startedAt && event.completedAt && <time>{Math.max(0, event.completedAt - event.startedAt)} ms</time>}</div>
    <p>{primary.slice(0, 320)}</p>
    {failure && <p>{failure.guidance}</p>}
    {(event.state === 'failed' || event.state === 'unknown') && onDiagnostics && <button type="button" className="thread-tool-diagnostics-link" onClick={onDiagnostics}>Open session diagnostics</button>}
    {technical && <details className="thread-tool-technical"><summary>Technical details</summary><pre>{technical}</pre></details>}
  </div>
}

export function ThreadActivityGroup({ events, onDiagnostics }: { events: Tool[]; onDiagnostics?: () => void }) {
  const running = events.some(event => event.state === 'running'), failures = events.filter(event => event.state === 'failed').length, unconfirmed = events.filter(event => event.state === 'unknown').length
  const commands = events.every(event => ['commandExecution', 'Bash'].includes(event.name))
  const reading = events.every(event => ['Read', 'Glob', 'Grep'].includes(event.name))
  if (events.length === 1) {
    const event = events[0]
    return <details className={`thread-activity-single${event.state === 'failed' ? ' has-failure' : ''}`}>
      <summary>{event.state === 'running' ? <Loader2 size={14} className="thread-spin" /> : event.state === 'failed' ? <CircleAlert size={14} /> : event.state === 'unknown' ? <CircleHelp size={14} /> : <TerminalSquare size={14} />}
        <span>{names[event.name] ?? event.name}<small>{toolSummary(event)}</small></span><ChevronDown size={13} /></summary>
      <ThreadToolDiagnostic event={event} onDiagnostics={onDiagnostics} />
    </details>
  }
  return <details className={`thread-activity-group${failures ? ' has-failure' : ''}`}>
    <summary>{running ? <Loader2 size={14} className="thread-spin" /> : failures ? <CircleAlert size={14} /> : unconfirmed ? <CircleHelp size={14} /> : <Check size={14} />}<span>{running ? 'Running actions' : failures ? 'Actions need attention' : unconfirmed ? 'Actions need verification' : commands ? 'Ran commands' : reading ? 'Explored the project' : 'Completed actions'}<small> · {events.length} {events.length === 1 ? 'action' : 'actions'}{failures ? ` · ${failures} failed` : ''}{unconfirmed ? ` · ${unconfirmed} unconfirmed` : ''}</small></span><ChevronDown size={13} /></summary>
    <div className="thread-activity-items">{events.filter(event => event.state !== 'completed').map(event => renderItem(event, onDiagnostics))}
      {events.some(event => event.state === 'completed') && <details className="thread-activity-completed"><summary>Completed actions <small>{events.filter(event => event.state === 'completed').length}</small><ChevronDown size={13} /></summary>
        {events.filter(event => event.state === 'completed').map(event => renderItem(event, onDiagnostics))}
      </details>}
    </div>
  </details>
}

function renderItem(event: Tool, onDiagnostics?: () => void) {
  return <details key={event.id} className="thread-activity-item">
    <summary><TerminalSquare size={13} /><span>{names[event.name] ?? event.name}<small>{toolSummary(event)}</small></span><span className="thread-activity-state">{event.state === 'running' ? 'Running' : event.state === 'failed' ? 'Failed' : event.state === 'unknown' ? 'Unconfirmed' : 'Done'}</span></summary>
    <ThreadToolDiagnostic event={event} onDiagnostics={onDiagnostics} />
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
