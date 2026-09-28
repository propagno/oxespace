import { ThreadPatch } from './ThreadPatch'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { BookOpen, Check, ChevronDown, FileCode2, ListTree, RefreshCw, Search, X } from 'lucide-react'
import type { ThreadArtifact, ThreadSnapshot } from '../../../shared/types/thread'
import type { GitHubPanelTab, Workspace } from '../../../shared/types/workspace'
import type { GitDiff, GitDiffHunk } from '../../../shared/types/git'
import { parseThreadPatch } from '../../../shared/threadPatch'
import { DropdownMenu } from 'radix-ui'
import { threadChanges, threadFileLabel } from './threadChanges'
import { FileStats } from './ThreadFileActivity'
import { ThreadPlan } from './ThreadPlan'
import { ThreadSubagentActivity } from './ThreadSubagentActivity'
import { useThreadWorkbenchStore, type ThreadPanel } from '../../store/thread-workbench.store'
import { useEditorStore } from '../../store/editor.store'
import { ThreadDiagnosticsPanel } from './ThreadDiagnosticsPanel'
import { DesktopDialog } from '../Navigation/DesktopDialog'
import { ThreadMarkdown } from './ThreadMarkdown'

export interface ThreadReviewComment { path: string; side: 'old' | 'new'; line: number; content: string; body: string; revision: string }
const EditorPane = lazy(() => import('../Editor/EditorPane').then(module => ({ default: module.EditorPane })))
const SearchPanel = lazy(() => import('../Search/SearchPanel').then(module => ({ default: module.SearchPanel })))
const ScriptsPanel = lazy(() => import('../Scripts/ScriptsPanel').then(module => ({ default: module.ScriptsPanel })))
const BackgroundJobsPanel = lazy(() => import('../Background/BackgroundJobsPanel').then(module => ({ default: module.BackgroundJobsPanel })))
const WebPreviewPanel = lazy(() => import('../WebPreview/WebPreviewPanel').then(module => ({ default: module.WebPreviewPanel })))
const GitHubPanel = lazy(() => import('../GitHub/GitHubPanel').then(module => ({ default: module.GitHubPanel })))
const TerminalPane = lazy(() => import('../Panes/TerminalPane').then(module => ({ default: module.TerminalPane })))
const labels: Record<ThreadPanel, string> = { changes: 'Session changes', project: 'Project changes', source: 'Source control', files: 'Files', search: 'Find in files', scripts: 'Scripts', background: 'Background jobs', preview: 'Web preview', terminal: 'Terminal', agents: 'Agents', plan: 'Plan', activity: 'Activity', diagnostics: 'Diagnostics' }

export function ThreadChangesPanel({ snapshot, workspace, panel, selection, onClose, onComment, onSendToConversation }: { snapshot: ThreadSnapshot; workspace?: Workspace; panel: ThreadPanel; selection?: string; onClose(): void; onComment(comment: ThreadReviewComment): void; onSendToConversation?(prompt: string): void }) {
  const [menu, setMenu] = useState(false), [search, setSearch] = useState(''), [refresh, setRefresh] = useState(0)
  const [gitHubTab, setGitHubTab] = useState<GitHubPanelTab>('status')
  const [artifact, setArtifact] = useState<ThreadArtifact | null>(null), [project, setProject] = useState<GitDiff | null>(null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const entries = useMemo(() => threadChanges(snapshot.events), [snapshot.events])
  const selected = entries.find(entry => entry.key === selection) ?? entries.at(-1)
  const [projectPath, setProjectPath] = useState('')
  const [markdownPath, setMarkdownPath] = useState<string | null>(null)
  const [markdownText, setMarkdownText] = useState(''), [markdownError, setMarkdownError] = useState(''), [markdownLoading, setMarkdownLoading] = useState(false)
  const projectFile = project?.files.find(file => file.path === projectPath) ?? project?.files[0]
  const evidenceId = selected?.file.artifactId
  useEffect(() => {
    if (!markdownPath) return
    let active = true
    setMarkdownText(''); setMarkdownError(''); setMarkdownLoading(true)
    void window.oxe.fs.readFile({ workspaceId: snapshot.thread.workspaceId, rootPath: snapshot.thread.rootPath, relativePath: markdownPath })
      .then(result => { if (active) setMarkdownText(result.content) }, cause => { if (active) setMarkdownError(cause instanceof Error ? cause.message : 'Could not read this Markdown file.') })
      .finally(() => { if (active) setMarkdownLoading(false) })
    return () => { active = false }
  }, [markdownPath, snapshot.thread.workspaceId, snapshot.thread.rootPath])
  const plan = snapshot.events.filter(event => event.type === 'plan').at(-1)
  const subagents = snapshot.events.filter(event => event.type === 'subagent')
  const delegationTools = snapshot.events.filter(event => event.type === 'tool' && /(?:spawn|followup|interrupt|list)[ _-]?agent|delegat/i.test(`${event.name} ${event.detail}`))
  const id = snapshot.thread.id
  const setPanel = (value: ThreadPanel) => { setMenu(false); useThreadWorkbenchStore.getState().setView(id, { panel: value }) }
  useEffect(() => {
    let active = true
    setArtifact(null); setError(''); setLoading(false)
    if (panel !== 'changes' || !evidenceId) return
    setLoading(true)
    const api = window.oxe?.thread
    if (!api?.artifact) { setError('Restart the updated application to load file evidence.'); setLoading(false); return }
    void api.artifact(id, evidenceId).then(value => { if (active) setArtifact(value) }, () => { if (active) setError('Could not load this file’s evidence. Retry to load it again.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id, panel, evidenceId, refresh])
  useEffect(() => {
    let active = true, inFlight = false
    setProject(null); setError('')
    if (panel !== 'project') return
    const api = window.oxe?.thread
    if (!api?.projectDiff) { setError('Restart the updated application to review project changes.'); setLoading(false); return }
    const load = (initial = false) => {
      if (!active || inFlight || document.visibilityState === 'hidden') return
      inFlight = true
      if (initial) setLoading(true)
      void api.projectDiff!(id).then(value => { if (active) { setProject(value); setError('') } }, error => { if (active) setError(error instanceof Error ? error.message : 'Could not read project changes.') }).finally(() => { inFlight = false; if (active) setLoading(false) })
    }
    load(true)
    const timer = window.setInterval(() => load(), 5000)
    const reconcile = () => load()
    window.addEventListener('focus', reconcile)
    document.addEventListener('visibilitychange', reconcile)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', reconcile); document.removeEventListener('visibilitychange', reconcile) }
  }, [id, panel, refresh])
  const path = panel === 'project' ? projectFile?.path : selected?.file.path
  const parsed = useMemo(() => artifact && artifact.source !== 'tool-input' ? parseThreadPatch(artifact.content) : null, [artifact])
  const hunks = panel === 'project' ? projectFile?.hunks : parsed?.hunks
  const revision = panel === 'project' ? `Project snapshot ${new Date(project?.compiledAt ?? 0).toISOString()}` : artifact?.hash ?? ''
  const scopedWorkspace = workspace ? { ...workspace, rootPath: snapshot.thread.rootPath } : undefined
  const terminalPane = workspace?.panes.find(pane => ['terminal', 'tasks'].includes(pane.type) && (pane.rootPath ?? workspace.rootPath) === snapshot.thread.rootPath)
  const openSearchFile = (relativePath: string) => {
    void useEditorStore.getState().openFile({ workspaceId: snapshot.thread.workspaceId, rootPath: snapshot.thread.rootPath, relativePath })
    useThreadWorkbenchStore.getState().setView(id, { panel: 'files' })
  }
  return <aside className="thread-review-panel" aria-label="Thread workbench">
    <header className="thread-review-heading"><div className="thread-review-menu"><DropdownMenu.Root open={menu} onOpenChange={setMenu}><DropdownMenu.Trigger asChild><button type="button" aria-label="Select review panel"><ListTree size={14} />{labels[panel]}<ChevronDown size={12} /></button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="thread-review-menu-items" align="start" sideOffset={6}><DropdownMenu.RadioGroup value={panel} onValueChange={value => setPanel(value as ThreadPanel)}>{(Object.keys(labels) as ThreadPanel[]).map(value => <DropdownMenu.RadioItem key={value} value={value} className="thread-review-menu-item">{labels[value]}<DropdownMenu.ItemIndicator><Check size={13} /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}</DropdownMenu.RadioGroup></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div>
      <button type="button" aria-label="Refresh review" title="Refresh" onClick={() => setRefresh(value => value + 1)} disabled={loading}><RefreshCw size={14} /></button><button type="button" aria-label="Close review panel" title="Close review" onClick={onClose}><X size={15} /></button></header>
    {panel === 'files' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<p className="thread-review-empty">Loading files…</p>}><EditorPane workspaceId={snapshot.thread.workspaceId} rootPath={snapshot.thread.rootPath} /></Suspense> : <p className="thread-review-empty">The project is unavailable.</p>}</div>
      : panel === 'source' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<p className="thread-review-empty">Loading source control…</p>}><GitHubPanel workspaceId={snapshot.thread.workspaceId} rootPath={snapshot.thread.rootPath} activeTab={gitHubTab} onTabChange={setGitHubTab} onOpenFile={openSearchFile} onRunCommand={command => onSendToConversation?.(`Run this project setup command and report the result:\n\n\`${command}\``)} /></Suspense> : <p className="thread-review-empty">The project is unavailable.</p>}</div>
      : panel === 'search' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<p className="thread-review-empty">Loading search…</p>}><SearchPanel workspace={scopedWorkspace} onOpenFile={openSearchFile} /></Suspense> : <p className="thread-review-empty">The project is unavailable.</p>}</div>
      : panel === 'scripts' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<p className="thread-review-empty">Loading scripts…</p>}><ScriptsPanel workspace={scopedWorkspace} embedded onClose={onClose} onOpenBackground={() => setPanel('background')} /></Suspense> : <p className="thread-review-empty">The project is unavailable.</p>}</div>
      : panel === 'background' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<p className="thread-review-empty">Loading background jobs…</p>}><BackgroundJobsPanel workspaceId={snapshot.thread.workspaceId} /></Suspense> : <p className="thread-review-empty">The project is unavailable.</p>}</div>
      : panel === 'preview' ? <div className="thread-review-body thread-tool-surface">{scopedWorkspace ? <Suspense fallback={<p className="thread-review-empty">Loading web preview…</p>}><WebPreviewPanel workspace={scopedWorkspace} embedded onClose={onClose} onRunCommand={() => {}} onSendToAgent={onSendToConversation} /></Suspense> : <p className="thread-review-empty">The project is unavailable.</p>}</div>
      : panel === 'terminal' ? <div className="thread-review-body thread-tool-surface thread-terminal-surface">{workspace && terminalPane ? <Suspense fallback={<p className="thread-review-empty">Loading terminal…</p>}><TerminalPane pane={terminalPane} workspaceId={workspace.id} workspaceRootPath={snapshot.thread.rootPath} autoStart={false} /></Suspense> : <p className="thread-review-empty">No terminal is available for this project directory.</p>}</div>
      : panel === 'diagnostics' ? <div className="thread-review-body"><ThreadDiagnosticsPanel snapshot={snapshot} /></div>
      : panel === 'agents' ? <div className="thread-review-body thread-review-agents">
        <p className="thread-capability-note" role="status"><strong>Agent controls</strong><span>{snapshot.thread.capabilities?.features.subagentLifecycle?.enabled ? 'Native lifecycle controls are available.' : snapshot.thread.capabilities?.features.subagentLifecycle?.reason ?? 'Independent child controls are unavailable for this provider session.'}</span></p>
        {subagents.map(event => event.type === 'subagent' && <ThreadSubagentActivity key={event.id} event={event} />)}{delegationTools.map(event => event.type === 'tool' && <details className="thread-agent-tool" key={event.id}><summary>{event.detail || event.name}<small>{event.state}</small></summary>{event.output && <pre>{event.output}</pre>}</details>)}{!subagents.length && !delegationTools.length && <p className="thread-review-empty">No agent delegation has been reported in this conversation yet.</p>}</div>
      : panel === 'plan' ? <div className="thread-review-body thread-review-log">{plan?.type === 'plan' ? <ThreadPlan event={plan} /> : <p className="thread-review-empty">No plan has been reported by this conversation’s provider yet.</p>}</div> : panel === 'activity' ? <div className="thread-review-body thread-review-log">{snapshot.events.filter(event => event.type === 'tool').map(event => event.type === 'tool' && <details key={event.id}><summary>{event.name}<small>{event.state}</small></summary>{event.completedAt && <time>{new Date(event.completedAt).toLocaleString()}</time>}<pre>{event.detail}</pre>{event.output && <pre>{event.output}</pre>}{event.exitCode !== undefined && <p>Exit code {event.exitCode}</p>}</details>)}{!snapshot.events.some(event => event.type === 'tool') && <p className="thread-review-empty">No tool activity in this conversation yet.</p>}</div> : <>
      <p className="thread-review-source">{panel === 'project' ? 'Tracked files compared with HEAD. Includes earlier work and other processes; untracked files are excluded.' : 'Historical tool evidence from this conversation. Repeated edits remain separate operations.'}</p>
      <label className="thread-review-search"><Search size={13} /><input aria-label="Filter changed files" value={search} placeholder="Filter files…" onChange={event => setSearch(event.target.value)} /></label>
      <div className="thread-review-file-list" aria-label="Changed files">{panel === 'project' ? project?.files.filter(file => file.path.toLowerCase().includes(search.toLowerCase())).map((file, index) => <button key={`${file.path}:${index}`} type="button" aria-current={file === projectFile ? 'true' : undefined} aria-label={/\.md$/i.test(file.path) ? `Read Markdown ${file.path}` : undefined} onClick={() => { setProjectPath(file.path); if (/\.md$/i.test(file.path)) setMarkdownPath(file.path) }}><FileCode2 size={13} /><span>{file.path}</span>{/\.md$/i.test(file.path) && <BookOpen size={13} className="thread-markdown-file-icon" aria-hidden="true" />}<FileStats file={{ path: file.path, kind: 'update', state: 'completed', source: 'native-patch', additions: file.additions, deletions: file.deletions }} /></button>)
        : entries.filter(entry => entry.file.path.toLowerCase().includes(search.toLowerCase())).map((entry, index) => <button key={entry.key} type="button" aria-current={entry.key === selected?.key ? 'true' : undefined} onClick={() => useThreadWorkbenchStore.getState().setView(id, { selection: entry.key })} title={entry.file.path}><FileCode2 size={13} /><span>{threadFileLabel(entry.file.path, snapshot.thread.rootPath)}</span><small>{entry.toolId.startsWith('turn-diff:') || entry.toolId.startsWith('verified-diff:') ? 'Turn' : `#${index + 1}`}</small><FileStats file={entry.file} /></button>)}</div>
      <div className="thread-review-body">
        {error && <div role="alert" className="thread-review-error"><p>{error}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
        {loading && <p role="status" className="thread-review-empty">Loading changes…</p>}
        {!loading && !error && !path && <div className="thread-review-empty"><FileCode2 size={24} /><h3>No {panel === 'project' ? 'tracked project changes' : 'file evidence'} yet</h3><p>{panel === 'project' ? 'Refresh after editing a tracked file.' : 'New file operations will appear here. Older conversations may only contain tool logs.'}</p></div>}
        {path && !loading && !error && <><div className="thread-review-file-heading"><strong title={path}>{threadFileLabel(path, snapshot.thread.rootPath)}</strong>{panel === 'project' && /\.md$/i.test(path) && <button type="button" className="thread-markdown-open" onClick={() => setMarkdownPath(path)}><BookOpen size={13} />Read Markdown</button>}{panel === 'changes' && <small>{selected?.file.state} · {selected?.file.kind}</small>}</div>
          {panel === 'changes' && selected?.file.previousPath && <p className="thread-review-source">Renamed from {threadFileLabel(selected.file.previousPath, snapshot.thread.rootPath)}</p>}
          {panel === 'changes' && selected?.file.source === 'tool-input' && <p className="thread-review-source">Tool input, with its reported result. This is not a verified disk diff; line totals are unavailable.</p>}
          {panel === 'changes' && selected?.file.source === 'working-tree-observation' && <p className="thread-review-source">Observed in the working tree after this turn. The disk change is verified, but provider authorship cannot be proven when hooks, shells or other processes may also write.</p>}
          {selected?.file.truncated && panel === 'changes' && <p className="thread-review-source">Evidence is incomplete. Counts and complete reconstruction are unavailable.</p>}
          {hunks?.length ? <ThreadPatch key={`${id}:${path}:${revision}`} hunks={hunks} onComment={(line, body) => onComment({ path, side: line.newLineNo !== null ? 'new' : 'old', line: line.newLineNo ?? line.oldLineNo ?? 0, content: line.content, body, revision })} /> : artifact ? <pre className="thread-review-raw">{artifact.content}</pre> : <p className="thread-review-empty">{panel === 'project' ? 'No text hunks available (binary, rename or empty file).' : 'The provider did not supply a stored patch for this operation.'}</p>}
        </>}
      </div>
      {panel === 'project' && project && <footer className="thread-review-footer">Checked {new Date(project.compiledAt).toLocaleTimeString()} · {project.files.length} files</footer>}
    </>}
    {markdownPath && <DesktopDialog className="thread-markdown-dialog" title={markdownPath.split(/[\\/]/).at(-1) ?? markdownPath} description={markdownPath} onClose={() => setMarkdownPath(null)}>
      <div className="thread-markdown-reader" role="region" aria-label="Markdown document" tabIndex={0}>
        {markdownLoading ? <p role="status">Loading document…</p> : markdownError ? <p role="alert">{markdownError}</p> : <ThreadMarkdown text={markdownText} />}
      </div>
    </DesktopDialog>}
  </aside>
}
