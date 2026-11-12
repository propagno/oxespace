import { Server } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { detectDevServers, launchAutoVerify, packageManagerFor, urlFromOutput, type DevServerConfig } from '../../../shared/dev-server'
import { selectJobs, useBackgroundStore } from '../../store/background.store'
import { Menu, type MenuEntry } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

interface Project { id: string; rootPath: string }

/** The label of the background job of a dev server: how the Browser finds the job it started, also after a reload. */
export const devServerJobLabel = (config: Pick<DevServerConfig, 'name'>): string => `dev server: ${config.name}`

/**
 * In a conversation the server runs in a terminal of the conversation's project (background jobs belong to OxeCode
 * workspaces): the last of the eight a conversation has, so the person finds it in the Terminal tab.
 */
const THREAD_DEV_SLOT = 8
const threadDevPane = (threadId: string): string => `thread-shell:${threadId}:${THREAD_DEV_SLOT}`
/** The server a conversation's terminal is running, and what it printed. Kept while the app runs: the panel closes and reopens. */
const threadRuns = new Map<string, { configId: string; output: string }>()
const MAX_OUTPUT = 20_000
/** The address each server printed, by project: the menu opens the real one also after the panel was closed and reopened. */
const printedUrls = new Map<string, Record<string, string>>()

const joinPath = (root: string, relative: string): string => `${root.replace(/[\\/]+$/, '')}${root.includes('\\') ? '\\' : '/'}${root.includes('\\') ? relative.replace(/\//g, '\\') : relative}`
const readText = (project: Project, relativePath: string): Promise<string | null> =>
  window.oxe.fs.readFile({ workspaceId: project.id, rootPath: project.rootPath, relativePath }).then(file => file.content, () => null)

export interface DevServers {
  servers: DevServerConfig[]
  /** `autoVerify` of `.claude/launch.json`; null when the project has no launch file. */
  autoVerify: boolean | null
  isRunning: (config: DevServerConfig) => boolean
  /** Where the server answers: the address it printed when it was started from here, else the expected one. */
  urlOf: (config: DevServerConfig) => string
  /** The server just started from here, until its page is shown: the address it printed, when it printed one. */
  starting: { name: string; url: string; since: number; printedUrl: string | null } | null
  /** The page of the started server is on screen (or was given up on): nothing more to wait for. */
  settle: () => void
  /** False for a server the person runs themselves (a launch entry with only an address): there is nothing to start. */
  start: (config: DevServerConfig) => Promise<boolean>
  stop: (config: DevServerConfig) => Promise<void>
  refresh: () => void
}

/**
 * What the project can run to put its page up, read from `.claude/launch.json` and `package.json`, and the running of
 * it: a background job in OxeCode, a terminal of the project in a conversation.
 */
export function useDevServers(project: Project, threadId?: string): DevServers {
  const [servers, setServers] = useState<DevServerConfig[]>([])
  const [autoVerify, setAutoVerify] = useState<boolean | null>(null)
  const [stamp, setStamp] = useState(0)
  const [started, setStarted] = useState<{ configId: string; name: string; url: string; since: number; jobId: string | null } | null>(null)
  const [, setTick] = useState(0)
  const printedKey = threadId ? `thread:${threadId}` : project.id
  const [printed, setPrintedState] = useState<Record<string, string>>(() => printedUrls.get(printedKey) ?? {})
  const setPrinted = useCallback((update: (current: Record<string, string>) => Record<string, string>): void => setPrintedState(current => { const next = update(current); printedUrls.set(printedKey, next); return next }), [printedKey])
  const jobs = useBackgroundStore(selectJobs(project.id))
  const jobOutput = useBackgroundStore(state => (started?.jobId ? state.outputByJob[started.jobId] : undefined))
  useEffect(() => {
    let cancelled = false
    if (!project.rootPath) { setServers([]); setAutoVerify(null); return }
    void Promise.all([
      readText(project, '.claude/launch.json'),
      readText(project, 'package.json'),
      window.oxe.fs.listTree({ workspaceId: project.id, rootPath: project.rootPath }).then(nodes => nodes.filter(node => node.type !== 'directory').map(node => node.name), () => [] as string[])
    ]).then(([launchJson, packageJson, files]) => {
      if (cancelled) return
      setServers(detectDevServers({ launchJson, packageJson, packageManager: packageManagerFor(files) }))
      setAutoVerify(launchAutoVerify(launchJson))
    })
    if (!threadId) void useBackgroundStore.getState().loadJobs(project.id)
    return () => { cancelled = true }
    // `stamp` asks for a fresh read: the files may have been written since (an agent adds a launch file).
  }, [project.id, project.rootPath, threadId, stamp]) // eslint-disable-line react-hooks/exhaustive-deps

  // The conversation's dev terminal: what it prints is kept for the address, and its end clears the run.
  useEffect(() => {
    if (!threadId) return
    const paneId = threadDevPane(threadId)
    const offData = window.oxe.terminal.onData(paneId, event => {
      const run = threadRuns.get(threadId)
      if (!run || run.output.length >= MAX_OUTPUT) return
      run.output = (run.output + event.data).slice(0, MAX_OUTPUT)
      setTick(value => value + 1)
    })
    const offExit = window.oxe.terminal.onExit(paneId, () => { threadRuns.delete(threadId); setTick(value => value + 1) })
    return () => { offData(); offExit() }
  }, [threadId])

  const isRunning = useCallback((config: DevServerConfig): boolean => threadId
    ? threadRuns.get(threadId)?.configId === config.id
    : jobs.some(job => job.label === devServerJobLabel(config) && (job.status === 'running' || job.status === 'pending')), [jobs, threadId])
  const start = useCallback(async (config: DevServerConfig): Promise<boolean> => {
    if (!config.command) return false
    if (threadId) {
      const paneId = threadDevPane(threadId)
      await window.oxe.terminal.stop({ paneId }).catch(() => undefined)
      await window.oxe.terminal.start({ paneId, workspaceId: project.id })
      threadRuns.set(threadId, { configId: config.id, output: '' })
      // The command is typed into the project's shell, as the person would: it runs in the project's folder.
      const enter = config.cwd ? `cd ${JSON.stringify(joinPath(project.rootPath, config.cwd))}\r` : ''
      await window.oxe.terminal.write({ paneId, data: `${enter}${config.command}\r` })
      setStarted({ configId: config.id, name: config.name, url: config.url, since: Date.now(), jobId: null })
      return true
    }
    const job = await useBackgroundStore.getState().startJob({ workspaceId: project.id, workspaceRootPath: project.rootPath, command: config.command, label: devServerJobLabel(config), paneRootPath: config.cwd ? joinPath(project.rootPath, config.cwd) : null, confirmed: true })
    setStarted({ configId: config.id, name: config.name, url: config.url, since: Date.now(), jobId: job.id })
    return true
  }, [project.id, project.rootPath, threadId])
  const stop = useCallback(async (config: DevServerConfig): Promise<void> => {
    if (threadId) { threadRuns.delete(threadId); setTick(value => value + 1); await window.oxe.terminal.stop({ paneId: threadDevPane(threadId) }); return }
    const job = jobs.find(item => item.label === devServerJobLabel(config) && (item.status === 'running' || item.status === 'pending'))
    if (job) await useBackgroundStore.getState().stopJob(job.id)
  }, [jobs, threadId])
  const refresh = useCallback(() => setStamp(value => value + 1), [])
  const settle = useCallback(() => setStarted(null), [])

  const output = started ? (started.jobId ? (jobOutput ?? []).join('\n') : threadId ? threadRuns.get(threadId)?.output ?? '' : '') : ''
  const printedUrl = started ? urlFromOutput(output) : null
  const starting = useMemo(() => started ? { name: started.name, url: started.url, since: started.since, printedUrl } : null, [started, printedUrl])
  const startedId = started?.configId
  useEffect(() => { if (startedId && printedUrl) setPrinted(current => current[startedId] === printedUrl ? current : { ...current, [startedId]: printedUrl }) }, [startedId, printedUrl, setPrinted])
  const urlOf = useCallback((config: DevServerConfig): string => printed[config.id] ?? config.url, [printed])
  return useMemo(() => ({ servers, autoVerify, isRunning, urlOf, starting, settle, start, stop, refresh }), [servers, autoVerify, isRunning, urlOf, starting, settle, start, stop, refresh])
}

interface DevServerMenuProps {
  dev: DevServers
  /** Starts the server and shows its page when it is up. */
  onStart: (config: DevServerConfig) => void
  onOpen: (url: string) => void
  onNotice: (text: string) => void
}

/** The Browser's "Dev servers" menu: each server of the project with its command, to start, stop or open. */
export function DevServerMenu({ dev, onNotice, onOpen, onStart }: DevServerMenuProps): ReactElement {
  const { t } = useTranslation('code')
  const running = dev.servers.filter(config => dev.isRunning(config)).length
  const items: MenuEntry[] = dev.servers.length === 0
    ? [{ type: 'label', label: t('preview.devServer.none') }]
    : dev.servers.flatMap((config, index): MenuEntry[] => {
      const up = dev.isRunning(config)
      const entries: MenuEntry[] = index > 0 ? [{ type: 'separator' }] : []
      if (config.command) entries.push(up
        ? { label: t('preview.devServer.stop', { name: config.name }), hint: config.command, onSelect: () => { void dev.stop(config).catch(error => onNotice(humanizeError(error, t('preview.devServer.stopFailed', { name: config.name })))) } }
        : { label: t('preview.devServer.start', { name: config.name }), hint: config.cwd ? t('preview.devServer.commandIn', { command: config.command, folder: config.cwd }) : config.command, onSelect: () => onStart(config) })
      if (up || !config.command) entries.push({ label: t('preview.devServer.open', { url: dev.urlOf(config) }), onSelect: () => onOpen(dev.urlOf(config)) })
      return entries
    })
  const label = running > 0 ? t('preview.devServer.labelRunning', { count: running }) : t('preview.devServer.label')
  return (
    <Menu
      label={t('preview.devServer.label')}
      align="end"
      trigger={
        <button type="button" className="web-preview-nav-button web-preview-dev-server" aria-label={label} title={label} data-testid="dev-server-menu" data-running={running > 0 ? 'true' : undefined} onPointerDown={dev.refresh}>
          <Server size={14} aria-hidden="true" />
        </button>
      }
      items={items}
    />
  )
}
