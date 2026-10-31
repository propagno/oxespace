import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadPanel } from '../../store/thread-workbench.store'
import { useUIStore } from '../../store/ui.store'
import { useGitBranch } from '../../hooks/useGitBranch'
import { Badge, Button, EmptyState, Meter } from '../../ui'
import { formatClock, formatNumber } from '../../utils/formatTime'
import { compactTokens } from './ThreadUsagePanel'
import { formatThreadCost } from './threadCost'
import { ThreadMcpServerList } from './ThreadMcpServerList'
import { changeSummary, threadChanges, threadFileLabel, threadWorkingRoot } from './threadChanges'
import { sessionBackground, sessionContext, sessionToolUse } from './threadSessionModel'
import styles from './ThreadSessionPanel.module.css'

/** How many tools, files and pages a section lists before it says how many more there are. */
const LISTED = 6

export interface SessionSectionProps {
  snapshot: ThreadSnapshot
  workspace?: Workspace
  running: boolean
  onOpenPanel(panel: ThreadPanel): void
  onCompact?: () => void
}

const lastSegment = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

/** Project, folder, worktree, branch, agent and model. */
export function SessionEnvironment({ snapshot, workspace }: SessionSectionProps): ReactElement {
  const { t } = useTranslation('thread')
  const thread = snapshot.thread
  const root = threadWorkingRoot(thread)
  const branch = useGitBranch(thread.workspaceId, root)
  const observed = thread.observedLocation
  const worktree = thread.ownedWorktree ? t('sessionPanel.environment.worktreeOwn')
    : observed?.sameRepository && observed.checkoutRoot ? t('sessionPanel.environment.worktreeMoved')
      : t('sessionPanel.environment.worktreeNone')
  const branchName = branch?.branch ?? thread.ownedWorktree?.branch
  const model = thread.model ?? thread.contextReport?.model
  return <dl className={styles.facts}>
    <dt>{t('sessionPanel.environment.project')}</dt><dd>{workspace?.name ?? lastSegment(thread.rootPath)}</dd>
    <dt>{t('sessionPanel.environment.folder')}</dt><dd className={styles.path} title={root}>{root}</dd>
    <dt>{t('sessionPanel.environment.worktree')}</dt><dd>{worktree}</dd>
    <dt>{t('sessionPanel.environment.branch')}</dt><dd>{branchName ? <code>{branchName}</code> : <span className={styles.muted}>{t('sessionPanel.environment.branchUnknown')}</span>}</dd>
    {observed && !observed.sameRepository && <><dt>{t('sessionPanel.environment.outside')}</dt><dd className={styles.path} title={observed.cwd}>{observed.cwd}</dd></>}
    <dt>{t('sessionPanel.environment.agent')}</dt><dd>{thread.provider === 'claude' ? 'Claude Code' : 'Codex'}</dd>
    <dt>{t('sessionPanel.environment.model')}</dt><dd>{model ?? <span className={styles.muted}>{t('sessionPanel.environment.modelDefault')}</span>}</dd>
  </dl>
}

/**
 * The context window as the latest usage event reported it, by category, with Compact. While idle it asks the
 * provider once for a fresher report, as the composer's ring does; the newer of the two is shown.
 */
export function SessionContextSection({ snapshot, running, onCompact }: SessionSectionProps): ReactElement {
  const { t } = useTranslation('thread')
  const thread = snapshot.thread
  const [fresh, setFresh] = useState<typeof thread.contextReport | null>(null)
  useEffect(() => {
    const read = window.oxe?.thread?.contextUsage
    if (running || !read) return
    let live = true
    void read(thread.id).then(value => { if (live && value) setFresh(value) }, () => undefined)
    return () => { live = false }
  }, [thread.id, running])
  const stored = thread.contextReport
  const report = fresh && (!stored || fresh.capturedAt >= stored.capturedAt) ? fresh : stored
  const context = useMemo(() => sessionContext(report), [report])
  const cost = thread.costReport
  const compactBlocked = running ? t('sessionPanel.context.compactBusy') : !context?.used ? t('sessionPanel.context.compactEmpty') : ''
  const compactButton = onCompact && <div className={styles.actions}>
    <Button size="sm" disabled={Boolean(compactBlocked)} title={compactBlocked || t('sessionPanel.context.compactHint')} onClick={onCompact}>{t('sessionPanel.context.compact')}</Button>
    <span className={styles.muted}>{compactBlocked || t('sessionPanel.context.compactHint')}</span>
  </div>
  if (!context) return <><EmptyState compact title={t('sessionPanel.context.empty')}>{t('sessionPanel.context.emptyHint')}</EmptyState>{compactButton}</>
  const row = (key: string, label: string, tokens: number, kind?: 'free' | 'reserved') => <tr key={key} data-kind={kind}>
    <th scope="row">{label}</th><td>{compactTokens(tokens)}</td><td>{formatNumber(tokens / context.window, { style: 'percent', maximumFractionDigits: 1 })}</td>
  </tr>
  return <>
    <Meter label={t('sessionPanel.context.meter')} value={context.used} max={context.window}
      detail={t('sessionPanel.context.detail', { used: compactTokens(context.used), total: compactTokens(context.window), percent: context.percent })} />
    <table className={styles.table} aria-label={t('sessionPanel.context.breakdown')} data-testid="session-context-breakdown">
      <thead className="sr-only"><tr><th scope="col">{t('sessionPanel.context.category')}</th><th scope="col">{t('sessionPanel.context.tokens')}</th><th scope="col">{t('sessionPanel.context.share')}</th></tr></thead>
      <tbody>
        {context.rows.map(item => row(item.bucket, t(`sessionPanel.context.buckets.${item.bucket}`), item.tokens))}
        {context.unattributed > 0 && row('unattributed', context.itemized ? t('sessionPanel.context.unattributed') : t('sessionPanel.context.total'), context.unattributed)}
        {row('free', t('sessionPanel.context.free'), context.free, 'free')}
        {context.reserved > 0 && row('reserved', t('sessionPanel.context.reserved'), context.reserved, 'reserved')}
      </tbody>
    </table>
    {!context.itemized && <p className={styles.note}>{t('sessionPanel.context.notItemized', { provider: thread.provider === 'claude' ? 'Claude Code' : 'Codex' })}</p>}
    {context.deferred > 0 && <p className={styles.note}>{t('sessionPanel.context.deferred', { tokens: compactTokens(context.deferred) })}</p>}
    {context.autoCompactAt !== undefined && <p className={styles.note}>{t('sessionPanel.context.autoCompact', { tokens: compactTokens(context.autoCompactAt) })}</p>}
    {cost && cost.turns > 0 && <p className={styles.note}>{t('sessionPanel.context.cost', { cost: formatThreadCost(cost.totalUsd), count: cost.turns })}</p>}
    <p className={styles.note}>{t('sessionPanel.context.capturedAt', { time: formatClock(context.capturedAt, { hour: '2-digit', minute: '2-digit' }) })}</p>
    {compactButton}
  </>
}

/** MCP servers the session reported and the tools this conversation called. Read-only. */
export function SessionTools({ snapshot }: SessionSectionProps): ReactElement {
  const { t } = useTranslation('thread')
  const tools = useMemo(() => sessionToolUse(snapshot.events), [snapshot.events])
  const servers = snapshot.thread.mcpServers?.servers
  return <>
    <h4 className={styles.subheading}>{t('sessionPanel.tools.mcp')}</h4>
    {servers ? <ThreadMcpServerList servers={servers} workspaceId={snapshot.thread.workspaceId} /> : <EmptyState compact title={t('sessionPanel.tools.mcpUnknown')} />}
    <div className={styles.actions}><Button size="sm" variant="ghost" onClick={() => useUIStore.getState().openMcpPanel()}>{t('sessionPanel.tools.manage')}</Button></div>
    <h4 className={styles.subheading}>{t('sessionPanel.tools.used')}</h4>
    {tools.length ? <ul className={styles.list} aria-label={t('sessionPanel.tools.used')}>
      {tools.slice(0, LISTED).map(tool => <li key={`${tool.mcpServer ?? ''}:${tool.name}`}>
        <span className={styles.name} title={tool.name}>{tool.name}</span>
        {tool.mcpServer && <Badge>{tool.mcpServer}</Badge>}
        <span className={styles.count}>{t('sessionPanel.tools.calls', { count: tool.calls })}{tool.failed > 0 && <> · <span className={styles.failed}>{t('sessionPanel.tools.failed', { count: tool.failed })}</span></>}</span>
      </li>)}
    </ul> : <EmptyState compact title={t('sessionPanel.tools.none')} />}
    {tools.length > LISTED && <p className={styles.note}>{t('sessionPanel.more', { count: tools.length - LISTED })}</p>}
  </>
}

interface PreviewPage { id: string; url: string }

/** Files the agent changed and pages open in this conversation's browser. */
export function SessionOutputs({ snapshot, onOpenPanel }: SessionSectionProps): ReactElement {
  const { t } = useTranslation('thread')
  const entries = useMemo(() => threadChanges(snapshot.events), [snapshot.events])
  const summary = changeSummary(entries)
  const root = threadWorkingRoot(snapshot.thread)
  const files = [...new Set(entries.map(entry => threadFileLabel(entry.file.path, root)))]
  const [pages, setPages] = useState<PreviewPage[] | null>(null)
  const id = snapshot.thread.id
  useEffect(() => {
    const preview = window.oxe?.browserPreview
    if (!preview?.session) return
    let live = true
    void preview.session({ ownerKey: `thread:${id}`, action: 'open' })
      .then(session => { if (live) setPages(session.tabs.flatMap(tab => tab.url ? [{ id: tab.id, url: tab.url }] : [])) }, () => { if (live) setPages([]) })
    return () => { live = false }
  }, [id])
  return <>
    <h4 className={styles.subheading}>{t('sessionPanel.outputs.files')}</h4>
    {files.length ? <>
      <p className={styles.note}>{t('sessionPanel.outputs.summary', { count: summary.files })}{summary.exact && <> · <span className={styles.added}>+{summary.additions}</span> <span className={styles.removed}>−{summary.deletions}</span></>}</p>
      <ul className={styles.list} aria-label={t('sessionPanel.outputs.files')}>{files.slice(0, LISTED).map(file => <li key={file}><span className={styles.name} title={file}>{file}</span></li>)}</ul>
      {files.length > LISTED && <p className={styles.note}>{t('sessionPanel.more', { count: files.length - LISTED })}</p>}
      <div className={styles.actions}><Button size="sm" onClick={() => onOpenPanel('changes')}>{t('sessionPanel.outputs.review')}</Button></div>
    </> : <EmptyState compact title={t('sessionPanel.outputs.none')} />}
    <h4 className={styles.subheading}>{t('sessionPanel.outputs.previews')}</h4>
    {pages?.length ? <ul className={styles.list} aria-label={t('sessionPanel.outputs.previews')}>{pages.slice(0, LISTED).map(page => <li key={page.id}><span className={styles.name} title={page.url}>{page.url}</span></li>)}</ul>
      : <EmptyState compact title={t('sessionPanel.outputs.noPreviews')} />}
    <div className={styles.actions}><Button size="sm" variant="ghost" onClick={() => onOpenPanel('preview')}>{t('sessionPanel.outputs.openBrowser')}</Button></div>
  </>
}

/** Agents and tasks the provider started and has not finished. */
export function SessionBackground({ snapshot, onOpenPanel }: SessionSectionProps): ReactElement {
  const { t } = useTranslation('thread')
  const work = sessionBackground(snapshot.events, snapshot.thread.background)
  return <>
    {work.agents || work.tasks ? <ul className={styles.list}>
      {work.agents > 0 && <li><span className={styles.name}>{t('sessionPanel.background.agents', { count: work.agents })}</span></li>}
      {work.tasks > 0 && <li><span className={styles.name}>{t('sessionPanel.background.tasks', { count: work.tasks })}</span></li>}
    </ul> : <EmptyState compact title={t('sessionPanel.background.none')} />}
    <div className={styles.actions}><Button size="sm" variant="ghost" onClick={() => onOpenPanel('background')}>{t('sessionPanel.background.open')}</Button></div>
  </>
}
