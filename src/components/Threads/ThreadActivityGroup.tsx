import { useState } from 'react'
import { isOxespaceMcpTool, oxespaceToolLabel } from '../../../shared/oxespace-mcp-tools'
import { classifyToolRowKind, toolRow } from '../../../shared/thread-tool-rows'
import { threadToolSummary as toolSummary } from '../../../shared/threadToolSummary'
import { threadActionFailure } from '../../../shared/threadActionFailure'
import { Check, ChevronDown, ChevronRight, CircleAlert, CircleHelp, TerminalSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadEvent } from '../../../shared/types/thread'
import type { ThreadViewMode } from '../../store/thread-view-mode.store'
import { useThreadWorkbenchStore } from '../../store/thread-workbench.store'
import { i18n } from '../../i18n'
import { formatNumber } from '../../utils/formatTime'
import { Button, Spinner, StatusSignal } from '../../ui'
import { resolveToolOutputCut, useToolOutputCuts } from '../../store/tool-output-cut.store'
import { ToolOutputCutBanner, stepOutputTail } from './toolOutputCut'
import { ThreadInlineEvidence } from './ThreadFileActivity'
import { PathLink } from './PathLink'
import { extractRawToolTarget, summarizeShellCommand } from './toolStepFormat'
type Tool = Extract<ThreadEvent, { type: 'tool' }>
const NAMED = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'contextCompaction', 'Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write', 'Tool result'])
/** What an action did, in words; a tool the app does not know keeps the provider's own name. */
const toolName = (name: string): string => NAMED.has(name) ? i18n.t(`thread:activity.names.${name as 'Read'}`) : (oxespaceToolLabel(name) ?? name)

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
  const recordedCut = useToolOutputCuts((state) => state.cuts[event.id])
  const kind = diagnosticKind(event)
  const failureKind = event.state === 'failed' ? threadActionFailure(event.output ?? '') : undefined
  const failure = failureKind && { label: t(`actionFailure.${failureKind}.label`), guidance: t(`actionFailure.${failureKind}.guidance`) }
  const detail = event.detail.trim(), output = event.output?.trim() ?? ''
  const cut = resolveToolOutputCut(recordedCut, output, event.outputTruncated)
  const displayOutput = cut ? output.slice(0, cut.keptBytes) : output
  const technical = cut
    ? displayOutput
    : [detail && `${t('activity.input')}\n${detail}`, output && `${t('activity.output')}\n${output}`, event.exitCode !== undefined && t('activity.exitCode', { code: event.exitCode })].filter(Boolean).join('\n\n')
  const primary = event.state === 'failed'
    ? output.split('\n').find(line => line.trim()) || (event.exitCode !== undefined ? t('activity.failedExit', { code: event.exitCode }) : t('activity.failedPlain'))
    : event.state === 'unknown' ? t('activity.notConfirmed')
      : toolSummary(event) || output.split('\n').find(Boolean) || kind.label
  return <div className="thread-tool-diagnostic">
    <div className="thread-tool-diagnostic-meta"><span className={kind.className}>{failure?.label ?? kind.label}</span>{event.startedAt && event.completedAt && <time>{t('activity.duration', { ms: formatNumber(Math.max(0, event.completedAt - event.startedAt)) })}</time>}</div>
    <p>{primary.slice(0, 320)}</p>
    {failure && <p>{failure.guidance}</p>}
    {cut && <ToolOutputCutBanner cut={cut} fullOutput={output} toolLabel={toolName(event.name)} />}
    {event.interrupted && !event.interruptedHandled && <><p>{t('activity.interruptedHint')}</p>{onResolve && <div className="thread-tool-diagnostic-actions"><Button size="sm" variant="primary" onClick={() => onResolve(`/continue-interrupted ${event.id}`)}>{t('activity.continue')}</Button><Button size="sm" onClick={() => onResolve(`/dismiss-interrupted ${event.id}`)}>{t('activity.dismiss')}</Button></div>}</>}
    {event.interruptedHandled && <p>{t(`activity.interruptedHandled.${event.interruptedHandled}`)}</p>}
    {technical && <details className="thread-tool-technical"><summary>{t('activity.technical')}</summary><pre>{technical}</pre></details>}
  </div>
}

const EXPLORE_NAMES = new Set(['Read', 'LS', 'Grep', 'Glob', 'read_file', 'list_dir', 'grep_files'])
const SEARCH_NAMES = new Set(['Grep', 'Glob', 'grep_files'])

/** "1.8 s" / "1,8 s": one decimal, the span from the first start to the last end. */
function formatExploreSpan(ms: number, language: string): string {
  const seconds = (Math.max(0, ms) / 1000).toFixed(1)
  return `${language.toLowerCase().startsWith('pt') ? seconds.replace('.', ',') : seconds} s`
}

function toolInput(detail: string): Record<string, unknown> | undefined {
  const text = detail.trim()
  if (!text.startsWith('{')) return undefined
  try { return JSON.parse(text) as Record<string, unknown> } catch { return undefined }
}

function stepState(event: Tool): 'running' | 'failed' | 'done' {
  if (event.state === 'running') return 'running'
  if (event.state === 'failed' || (typeof event.exitCode === 'number' && event.exitCode !== 0)) return 'failed'
  return 'done'
}

const BADGED = new Set(['query', 'http', 'container', 'other'])

function mcpTitle(name: string): string | undefined {
  const match = /^mcp__(.+?)__(.+)$/.exec(name)
  return match ? `${match[1]} · ${match[2]}` : undefined
}

function httpStatus(output: string | undefined): string {
  return /HTTP\/\d+(?:\.\d+)?\s+(\d{3}\s+[A-Za-z]+)/.exec(output ?? '')?.[1] ?? ''
}

function queryTable(output: string | undefined): { columns: string[]; rows: string[][] } | undefined {
  if (!output?.trim().startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(output) as { columns?: unknown; rows?: unknown }
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return undefined
    return {
      columns: parsed.columns.map(column => String(column)),
      rows: parsed.rows.map(row => Array.isArray(row) ? row.map(cell => String(cell)) : [])
    }
  } catch { return undefined }
}

function TargetLink({ threadId, raw, turnId }: { threadId?: string; raw: string; turnId?: string }) {
  if (!threadId || !raw) return <>{raw}</>
  return <PathLink threadId={threadId} raw={raw} turnId={turnId} />
}

/** One read or search inside an exploration, with the lines read or the hits found. */
function ExploreStep({ event, root, threadId }: { event: Tool; root: string; threadId?: string }) {
  const { t } = useTranslation('thread')
  const target = toolRow(event, root).target
  const fullTarget = extractRawToolTarget(event, 'read')
  const search = SEARCH_NAMES.has(event.name)
  const input = toolInput(event.detail)
  const from = typeof input?.offset === 'number' ? input.offset : undefined
  const limit = typeof input?.limit === 'number' ? input.limit : undefined
  const range = !search && from !== undefined && limit !== undefined ? t('explore.lines', { from, to: from + limit - 1 }) : ''
  const hits = search ? (event.output ?? '').split('\n').filter(line => line.length > 0).length : 0
  return <div data-ui="step" data-kind={classifyToolRowKind(event.name)} data-state={stepState(event)} title={fullTarget || target || undefined}>
    {search
      ? <>{t('explore.searched')} &quot;<TargetLink threadId={threadId} raw={target} turnId={event.turnId} />&quot; · {t('explore.hits', { count: hits })}</>
      : <>{t('explore.read')} <TargetLink threadId={threadId} raw={target} turnId={event.turnId} />{range ? ` · ${range}` : ''}</>}
  </div>
}

/** A run of reads and searches, closed into one line until the person opens it. */
function ExploreGroup({ events, root, threadId }: { events: Tool[]; root: string; threadId?: string }) {
  const { t, i18n: bundle } = useTranslation('thread')
  const [open, setOpen] = useState(false)
  const searches = events.filter(event => SEARCH_NAMES.has(event.name)).length
  const start = Math.min(...events.map(event => event.startedAt ?? event.completedAt ?? 0))
  const end = Math.max(...events.map(event => event.completedAt ?? event.startedAt ?? start))
  const label = t('explore.summary', { files: events.length - searches, searches, duration: formatExploreSpan(end - start, bundle.language) })
  return <div data-ui="explore-group">
    <Button variant="ghost" size="sm" className="thread-explore-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <ChevronRight size={12} aria-hidden="true" className="thread-explore-chevron" />
      <span className="thread-step-label">{label}</span>
    </Button>
    {open && <div data-ui="explore-steps">{events.map(event => <ExploreStep key={event.id} event={event} root={root} threadId={threadId} />)}</div>}
  </div>
}

/** One tool that is not part of an exploration: its state signal, and the detail it keeps closed. */
function ToolStep({ event, root, threadId, onDraft }: { event: Tool; root: string; threadId?: string; onDraft?: (text: string) => void }) {
  const { t } = useTranslation('thread')
  const row = toolRow(event, root)
  const state = stepState(event)
  const [open, setOpen] = useState(state === 'failed' && row.kind === 'run')
  const [allLines, setAllLines] = useState(false)
  const recordedCut = useToolOutputCuts(store => store.cuts[event.id])
  const rawOutput = event.output ?? ''
  const cut = resolveToolOutputCut(recordedCut, rawOutput, event.outputTruncated)
  const output = cut ? rawOutput.slice(0, cut.keptBytes) : rawOutput
  const { shown, hidden } = stepOutputTail(output, allLines)
  const input = toolInput(event.detail)
  const status = row.kind === 'http' ? httpStatus(event.output) : ''
  const table = row.kind === 'query' ? queryTable(event.output) : undefined
  const mcp = mcpTitle(event.name)
  const isShellRun = row.kind === 'run' && !event.name.startsWith('mcp__') && !isOxespaceMcpTool(event.name)
  const fullTarget = extractRawToolTarget(event, row.kind)
  const shellSummary = isShellRun ? (summarizeShellCommand(fullTarget || row.target, root) || row.target || toolName(event.name)) : ''
  const showFullCommand = open && isShellRun && Boolean(fullTarget) && fullTarget !== shellSummary
  const sql = typeof input?.sql === 'string' ? input.sql : ''
  const headline = row.kind === 'http' ? [row.target, status].filter(Boolean).join(' ')
    : row.kind === 'other' && mcp ? mcp
      : row.kind === 'query' ? (sql || row.target || toolName(event.name))
        : row.target || toolName(event.name)
  const isEditWithTarget = row.kind === 'edit' && Boolean(row.target)
  const editFile = event.files?.[0]
  const editVerbKey = editFile
    ? (editFile.state === 'failed' || editFile.state === 'running' || editFile.state === 'unknown'
        ? editFile.state
        : editFile.kind === 'add' || editFile.kind === 'delete' || editFile.kind === 'rename'
          ? editFile.kind
          : 'update')
    : null
  const editLabel = editVerbKey ? t(`files.verb.${editVerbKey}`) : t('fold.kinds.edit')
  const openChanges = () => { if (threadId) useThreadWorkbenchStore.getState().setView(threadId, { panel: 'changes' }) }
  const artifactId = event.files?.find(file => file.artifactId)?.artifactId
  const showsPlainOutput = row.kind === 'http' || row.kind === 'other' || row.kind === 'container' || row.kind === 'read' || (row.kind === 'query' && !table) || (row.kind === 'edit' && !(threadId && artifactId))
  return <div data-ui="step" data-kind={row.kind} data-state={state} data-open={open ? 'true' : 'false'}>
    <div className="thread-step-line">
      <span className="thread-step-signal">
        {state === 'running' ? <Spinner size="sm" decorative /> : <StatusSignal state={state === 'failed' ? 'failed' : 'done'} label={t(`activity.state.${state === 'failed' ? 'failed' : 'completed'}`)} size={14} />}
      </span>
      {BADGED.has(row.kind) && <span data-ui="kind-badge" data-kind={row.kind}>{t(`fold.kinds.${row.kind}`)}</span>}
      {isEditWithTarget ? (
        <>
          <Button variant="ghost" size="sm" className="thread-step-toggle thread-step-edit-toggle" aria-expanded={open} title={t('files.expand', { path: row.target })} onClick={() => setOpen(value => !value)}>
            <ChevronRight size={12} aria-hidden="true" className="thread-step-chevron" />
            <span>{editLabel}</span>
          </Button>
          <Button variant="ghost" size="sm" className="thread-step-file-pill" data-ui="file-pill" title={fullTarget || row.target} onClick={openChanges}>
            <span className="thread-step-label">{row.target}</span>
          </Button>
        </>
      ) : isShellRun ? (
        <Button variant="ghost" size="sm" className="thread-step-toggle" aria-expanded={open} title={fullTarget || shellSummary} onClick={() => setOpen(value => !value)}>
          <code className="thread-step-code">$ <span>{shellSummary}</span></code>
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className="thread-step-toggle" aria-expanded={open} title={fullTarget || headline} onClick={() => setOpen(value => !value)}>
          <span className="thread-step-label">{headline}</span>
        </Button>
      )}
      {(row.meta.additions || row.meta.deletions) ? <span className="thread-step-stats">+{row.meta.additions ?? 0} −{row.meta.deletions ?? 0}</span> : null}
    </div>
    {showFullCommand && <pre className="thread-step-command" data-ui="step-command">{fullTarget}</pre>}
    {open && row.kind === 'run' && output && <>
      {cut && <ToolOutputCutBanner cut={cut} fullOutput={rawOutput} toolLabel={headline} />}
      <pre data-ui="step-output">{shown}</pre>
      {hidden > 0 && <Button variant="ghost" size="sm" className="thread-step-more" onClick={() => setAllLines(true)}>{t('steps.showMoreLines', { count: hidden })}</Button>}
    </>}
    {open && row.kind === 'query' && table && <table>
      <thead><tr>{table.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
      <tbody>{table.rows.map((cells, index) => <tr key={index}>{cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
    </table>}
    {open && showsPlainOutput && output && <>
      {cut && <ToolOutputCutBanner cut={cut} fullOutput={rawOutput} toolLabel={headline} />}
      <pre data-ui="step-output">{output}</pre>
    </>}
    {open && row.kind === 'edit' && threadId && artifactId && <ThreadInlineEvidence threadId={threadId} artifactId={artifactId} onComment={(_line, body) => onDraft?.(body)} />}
  </div>
}

function segmentTools(events: Tool[]): Array<{ kind: 'explore' | 'other'; events: Tool[] }> {
  const out: Array<{ kind: 'explore' | 'other'; events: Tool[] }> = []
  for (const event of events) {
    const kind = EXPLORE_NAMES.has(event.name) ? 'explore' : 'other'
    const last = out.at(-1)
    if (last?.kind === kind) last.events.push(event)
    else out.push({ kind, events: [event] })
  }
  return out
}

export function ThreadActivityGroup({ events, mode = 'verbose', rootPath = '', threadId, onResolveInterrupted, onDraft }: { events: Tool[]; mode?: ThreadViewMode; rootPath?: string; threadId?: string; onResolveInterrupted?: ResolveInterrupted; onDraft?: (text: string) => void }) {
  const { t } = useTranslation('thread')
  const running = events.some(event => event.state === 'running'), failures = events.filter(event => event.state === 'failed').length, unconfirmed = events.filter(event => event.state === 'unknown').length
  if (mode === 'normal') {
    return <>{segmentTools(events).map(part => part.kind === 'explore'
      ? <ExploreGroup key={part.events[0].id} events={part.events} root={rootPath} threadId={threadId} />
      : part.events.map(event => <ToolStep key={event.id} event={event} root={rootPath} threadId={threadId} onDraft={onDraft} />))}</>
  }
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
