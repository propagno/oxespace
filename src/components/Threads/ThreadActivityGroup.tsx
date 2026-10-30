import { threadToolSummary as toolSummary } from '../../../shared/threadToolSummary'
import { threadActionFailure } from '../../../shared/threadActionFailure'
import { Check, ChevronDown, CircleAlert, CircleHelp, TerminalSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadEvent } from '../../../shared/types/thread'
import type { ThreadViewMode } from '../../store/thread-view-mode.store'
import { i18n } from '../../i18n'
import { formatNumber } from '../../utils/formatTime'
import { Button, Spinner } from '../../ui'
type Tool = Extract<ThreadEvent, { type: 'tool' }>
const NAMED = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'contextCompaction', 'Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write', 'Tool result'])
/** What an action did, in words; a tool the app does not know keeps the provider's own name. */
const toolName = (name: string): string => NAMED.has(name) ? i18n.t(`thread:activity.names.${name as 'Read'}`) : name

const COMMANDS = new Set(['commandExecution', 'Bash', 'PowerShell'])
const EDITS = new Set(['fileChange', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const READS = new Set(['Read', 'LS'])
const SEARCHES = new Set(['Glob', 'Grep'])

/** "Ran 4 commands, edited 2 files" — what happened, never the raw arguments. */
export function summarizeActivity(events: Tool[]): string {
  const t = i18n.t.bind(i18n)
  const count = (names: Set<string>): number => events.filter(event => names.has(event.name)).length
  const integrations = events.filter(event => event.name === 'mcpToolCall' || event.name.startsWith('mcp__')).length
  const parts: string[] = []
  const commands = count(COMMANDS), reads = count(READS), searches = count(SEARCHES)
  const editEvents = events.filter(event => EDITS.has(event.name))
  const editedFiles = new Set(editEvents.flatMap(event => event.files?.map(file => file.path) ?? []))
  const edits = editedFiles.size || editEvents.length
  if (commands) parts.push(t('thread:activity.ran', { count: commands }))
  if (edits) parts.push(t('thread:activity.edited', { count: edits }))
  if (reads) parts.push(t('thread:activity.read', { count: reads }))
  if (searches) parts.push(t('thread:activity.searched', { count: searches }))
  if (integrations) parts.push(t('thread:activity.used', { count: integrations }))
  const other = events.length - commands - editEvents.length - reads - searches - integrations
  if (other > 0) parts.push(parts.length ? t('thread:activity.other', { count: other }) : t('thread:activity.actionsOnly', { count: other }))
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function diagnosticKind(event: Tool): { label: string; className: string } {
  const t = i18n.t.bind(i18n)
  if (event.interrupted) return { label: t('thread:activity.interrupted'), className: 'is-unconfirmed' }
  const text = `${event.detail}\n${event.output ?? ''}`
  if (/not reachable|unavailable after \d+ attempts|request timed out|ECONN(?:REFUSED|RESET)|outcome=infrastructure/i.test(text)) return { label: t('thread:activity.infrastructure'), className: 'is-infrastructure' }
  if (/Quality Controller|outcome=validation|verdict=(?:PASS|WARN|FAIL)/i.test(text)) return { label: t('thread:activity.validation'), className: event.state === 'failed' || /verdict=FAIL/i.test(text) ? 'is-validation-warning' : 'is-validation' }
  return { label: t(event.state === 'failed' ? 'thread:activity.failed' : event.state === 'running' ? 'thread:activity.inProgress' : event.state === 'unknown' ? 'thread:activity.unconfirmed' : 'thread:activity.completed'), className: event.state === 'failed' ? 'is-failure' : event.state === 'unknown' ? 'is-unconfirmed' : '' }
}

/** Runs a person-only recovery command such as `/continue-interrupted <id>`. */
export type ResolveInterrupted = (command: string) => void

function ThreadToolDiagnostic({ event, onResolve }: { event: Tool; onResolve?: ResolveInterrupted }) {
  const { t } = useTranslation('thread')
  const kind = diagnosticKind(event)
  const failureKind = event.state === 'failed' ? threadActionFailure(event.output ?? '') : undefined
  const failure = failureKind && { label: t(`actionFailure.${failureKind}.label`), guidance: t(`actionFailure.${failureKind}.guidance`) }
  const detail = event.detail.trim(), output = event.output?.trim() ?? ''
  const technical = [detail && `${t('activity.input')}\n${detail}`, output && `${t('activity.output')}\n${output}`, event.exitCode !== undefined && t('activity.exitCode', { code: event.exitCode })].filter(Boolean).join('\n\n')
  const primary = event.state === 'failed'
    ? output.split('\n').find(line => line.trim()) || (event.exitCode !== undefined ? t('activity.failedExit', { code: event.exitCode }) : t('activity.failedPlain'))
    : event.state === 'unknown' ? t('activity.notConfirmed')
      : toolSummary(event) || output.split('\n').find(Boolean) || kind.label
  return <div className="thread-tool-diagnostic">
    <div className="thread-tool-diagnostic-meta"><span className={kind.className}>{failure?.label ?? kind.label}</span>{event.startedAt && event.completedAt && <time>{t('activity.duration', { ms: formatNumber(Math.max(0, event.completedAt - event.startedAt)) })}</time>}</div>
    <p>{primary.slice(0, 320)}</p>
    {failure && <p>{failure.guidance}</p>}
    {event.interrupted && !event.interruptedHandled && <><p>{t('activity.interruptedHint')}</p>{onResolve && <div className="thread-tool-diagnostic-actions"><Button size="sm" variant="primary" onClick={() => onResolve(`/continue-interrupted ${event.id}`)}>{t('activity.continue')}</Button><Button size="sm" onClick={() => onResolve(`/dismiss-interrupted ${event.id}`)}>{t('activity.dismiss')}</Button></div>}</>}
    {event.interruptedHandled && <p>{t(`activity.interruptedHandled.${event.interruptedHandled}`)}</p>}
    {technical && <details className="thread-tool-technical"><summary>{t('activity.technical')}</summary><pre>{technical}</pre></details>}
  </div>
}

export function ThreadActivityGroup({ events, mode = 'verbose', onResolveInterrupted }: { events: Tool[]; mode?: ThreadViewMode; onResolveInterrupted?: ResolveInterrupted }) {
  const { t } = useTranslation('thread')
  const running = events.some(event => event.state === 'running'), failures = events.filter(event => event.state === 'failed').length, unconfirmed = events.filter(event => event.state === 'unknown').length
  const commands = events.every(event => ['commandExecution', 'Bash'].includes(event.name))
  const reading = events.every(event => ['Read', 'Glob', 'Grep'].includes(event.name))
  if (events.length === 1) {
    const event = events[0]
    return <details className={`thread-activity-single${event.state === 'failed' ? ' has-failure' : ''}`}>
      <summary>{event.state === 'running' ? <Spinner size="sm" decorative /> : event.state === 'failed' ? <CircleAlert size={14} /> : event.state === 'unknown' ? <CircleHelp size={14} /> : <TerminalSquare size={14} />}
        <span>{mode === 'verbose' ? toolName(event.name) : summarizeActivity([event])}{mode === 'verbose' && <small>{toolSummary(event)}</small>}</span><ChevronDown size={14} /></summary>
      <ThreadToolDiagnostic event={event} onResolve={onResolveInterrupted} />
    </details>
  }
  return <details className={`thread-activity-group${failures ? ' has-failure' : ''}`}>
    <summary>{running ? <Spinner size="sm" decorative /> : failures ? <CircleAlert size={14} /> : unconfirmed ? <CircleHelp size={14} /> : <Check size={14} />}{mode === 'verbose'
      ? <span>{t(running ? 'activity.running' : failures ? 'activity.attention' : unconfirmed ? 'activity.verify' : commands ? 'activity.ranCommands' : reading ? 'activity.explored' : 'activity.completedActions')}<small>{t('activity.count', { count: events.length })}{failures ? t('activity.failedCount', { count: failures }) : ''}{unconfirmed ? t('activity.unconfirmedCount', { count: unconfirmed }) : ''}</small></span>
      : <span>{summarizeActivity(events)}{running ? '…' : ''}{(failures > 0 || unconfirmed > 0) && <small>{failures ? t('activity.failedCount', { count: failures }) : ''}{unconfirmed ? t('activity.unconfirmedCount', { count: unconfirmed }) : ''}</small>}</span>}<ChevronDown size={14} /></summary>
    <div className="thread-activity-items">{events.filter(event => event.state !== 'completed').map(event => <ActivityItem key={event.id} event={event} onResolve={onResolveInterrupted} />)}
      {events.some(event => event.state === 'completed') && <details className="thread-activity-completed"><summary>{t('activity.completedActions')} <small>{events.filter(event => event.state === 'completed').length}</small><ChevronDown size={14} /></summary>
        {events.filter(event => event.state === 'completed').map(event => <ActivityItem key={event.id} event={event} onResolve={onResolveInterrupted} />)}
      </details>}
    </div>
  </details>
}

function ActivityItem({ event, onResolve }: { event: Tool; onResolve?: ResolveInterrupted }) {
  const { t } = useTranslation('thread')
  return <details className="thread-activity-item">
    <summary><TerminalSquare size={14} /><span>{toolName(event.name)}<small>{toolSummary(event)}</small></span><span className="thread-activity-state">{t(`activity.state.${event.state === 'running' || event.state === 'failed' || event.state === 'unknown' ? event.state : 'completed'}`)}</span></summary>
    <ThreadToolDiagnostic event={event} onResolve={onResolve} />
  </details>
}

export function groupThreadEvents(events: ThreadEvent[], mode: ThreadViewMode = 'verbose'): (ThreadEvent | { type: 'activity-group'; id: string; events: Tool[] })[] {
  const blocks: ReturnType<typeof groupThreadEvents> = []
  for (const event of events) {
    const previous = blocks.at(-1)
    // Summary shows results only; the turn's changed-files card covers edits.
    if (mode === 'summary' && event.type === 'tool') continue
    // Normal folds file edits into the same one-line summary as the other actions.
    if (event.type === 'tool' && (mode !== 'verbose' || !event.files?.length)) {
      if (previous?.type === 'activity-group' && previous.events.at(-1)?.turnId === event.turnId) previous.events.push(event)
      else blocks.push({ type: 'activity-group', id: event.id, events: [event] })
    } else blocks.push(event)
  }
  return blocks
}
