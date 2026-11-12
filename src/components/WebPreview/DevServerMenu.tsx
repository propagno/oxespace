import { Server } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { detectDevServers, launchAutoVerify, packageManagerFor, type DevServerConfig } from '../../../shared/dev-server'
import type { BackgroundJob } from '../../../shared/types/background'
import { selectJobs, useBackgroundStore } from '../../store/background.store'
import { Menu, type MenuEntry } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

interface Project { id: string; rootPath: string }

/** The label of the background job of a dev server: how the Browser finds the job it started, also after a reload. */
export const devServerJobLabel = (config: Pick<DevServerConfig, 'name'>): string => `dev server: ${config.name}`

const joinPath = (root: string, relative: string): string => `${root.replace(/[\\/]+$/, '')}${root.includes('\\') ? '\\' : '/'}${root.includes('\\') ? relative.replace(/\//g, '\\') : relative}`
const readText = (project: Project, relativePath: string): Promise<string | null> =>
  window.oxe.fs.readFile({ workspaceId: project.id, rootPath: project.rootPath, relativePath }).then(file => file.content, () => null)

export interface DevServers {
  servers: DevServerConfig[]
  /** `autoVerify` of `.claude/launch.json`; null when the project has no launch file. */
  autoVerify: boolean | null
  /** The running job of a server, when the Browser (or the person, with the same label) started it. */
  jobFor: (config: DevServerConfig) => BackgroundJob | null
  start: (config: DevServerConfig) => Promise<BackgroundJob | null>
  stop: (config: DevServerConfig) => Promise<void>
  refresh: () => void
}

/** What the project can run to put its page up, read from `.claude/launch.json` and `package.json`. */
export function useDevServers(project: Project): DevServers {
  const [servers, setServers] = useState<DevServerConfig[]>([])
  const [autoVerify, setAutoVerify] = useState<boolean | null>(null)
  const [stamp, setStamp] = useState(0)
  const jobs = useBackgroundStore(selectJobs(project.id))
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
    void useBackgroundStore.getState().loadJobs(project.id)
    return () => { cancelled = true }
    // `stamp` asks for a fresh read: the files may have been written since (an agent adds a launch file).
  }, [project.id, project.rootPath, stamp]) // eslint-disable-line react-hooks/exhaustive-deps
  const jobFor = useCallback((config: DevServerConfig): BackgroundJob | null => jobs.find(job => job.label === devServerJobLabel(config) && (job.status === 'running' || job.status === 'pending')) ?? null, [jobs])
  const start = useCallback(async (config: DevServerConfig): Promise<BackgroundJob | null> => {
    if (!config.command) return null
    return useBackgroundStore.getState().startJob({ workspaceId: project.id, workspaceRootPath: project.rootPath, command: config.command, label: devServerJobLabel(config), paneRootPath: config.cwd ? joinPath(project.rootPath, config.cwd) : null, confirmed: true })
  }, [project.id, project.rootPath])
  const stop = useCallback(async (config: DevServerConfig): Promise<void> => { const job = jobFor(config); if (job) await useBackgroundStore.getState().stopJob(job.id) }, [jobFor])
  const refresh = useCallback(() => setStamp(value => value + 1), [])
  return useMemo(() => ({ servers, autoVerify, jobFor, start, stop, refresh }), [servers, autoVerify, jobFor, start, stop, refresh])
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
  const running = dev.servers.filter(config => dev.jobFor(config)).length
  const items: MenuEntry[] = dev.servers.length === 0
    ? [{ type: 'label', label: t('preview.devServer.none') }]
    : dev.servers.flatMap((config, index): MenuEntry[] => {
      const job = dev.jobFor(config)
      const entries: MenuEntry[] = index > 0 ? [{ type: 'separator' }] : []
      if (config.command) entries.push(job
        ? { label: t('preview.devServer.stop', { name: config.name }), hint: config.command, onSelect: () => { void dev.stop(config).catch(error => onNotice(humanizeError(error, t('preview.devServer.stopFailed', { name: config.name })))) } }
        : { label: t('preview.devServer.start', { name: config.name }), hint: config.cwd ? t('preview.devServer.commandIn', { command: config.command, folder: config.cwd }) : config.command, onSelect: () => onStart(config) })
      if (job || !config.command) entries.push({ label: t('preview.devServer.open', { url: config.url }), onSelect: () => onOpen(config.url) })
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
