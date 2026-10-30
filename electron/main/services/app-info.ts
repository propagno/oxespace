import { mainMessage } from '../../../shared/messages'
import type { AppAbout, AppConnectivity } from '../../../shared/types/app'

/** `dev` for an unpackaged run; a packaged pre-release (`-beta.1`, `-rc.2`, `-alpha`) is `beta`. */
export function appChannel(version: string, packaged: boolean): AppAbout['channel'] {
  if (!packaged) return 'dev'
  return /-(alpha|beta|rc)\b/i.test(version) ? 'beta' : 'stable'
}

export interface AboutSource {
  version: string
  packaged: boolean
  versions: Partial<Record<'electron' | 'chrome' | 'node' | 'v8', string>>
  platform: NodeJS.Platform
  arch: string
  osRelease: string
  /** Recorded by the build when it can; absent in a dev run. */
  commit?: string | null
  builtAt?: string | null
}

/** What the About screen shows: version, build and runtime. No paths, accounts or machine names. */
export function aboutFacts(source: AboutSource): AppAbout {
  const commit = typeof source.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(source.commit) ? source.commit.slice(0, 12) : null
  const builtAt = typeof source.builtAt === 'string' && !Number.isNaN(Date.parse(source.builtAt)) ? new Date(source.builtAt).toISOString() : null
  return {
    name: 'OXESpace',
    version: source.version,
    channel: appChannel(source.version, source.packaged),
    commit,
    builtAt,
    versions: { electron: source.versions.electron ?? '', chrome: source.versions.chrome ?? '', node: source.versions.node ?? '', v8: source.versions.v8 ?? '' },
    platform: source.platform,
    arch: source.arch,
    osRelease: source.osRelease,
    license: 'MIT',
    repositoryUrl: 'https://github.com/propagno/oxespace'
  }
}

export function connectivityOf(online: boolean | undefined, now: number): AppConnectivity {
  if (online === undefined) return { state: 'unknown', checkedAt: now }
  return online ? { state: 'online', checkedAt: now } : { state: 'offline', checkedAt: now, reason: mainMessage('app.connectivity.offline', {}) }
}

/**
 * Watches whether the system has a network route. It starts on the first read, so a run that never asks pays nothing,
 * and tells listeners only when the state changes.
 */
export class ConnectivityWatcher {
  private last: AppConnectivity | undefined
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly isOnline: () => boolean | undefined,
    private readonly publish: (state: AppConnectivity) => void,
    private readonly intervalMs = 15_000,
    private readonly now: () => number = Date.now
  ) {}

  read(): AppConnectivity {
    const state = this.check()
    if (!this.timer) {
      this.timer = setInterval(() => {
        const before = this.last?.state
        const after = this.check()
        if (after.state !== before) this.publish(after)
      }, this.intervalMs)
      this.timer.unref?.()
    }
    return state
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private check(): AppConnectivity {
    let online: boolean | undefined
    try { online = this.isOnline() } catch { online = undefined }
    this.last = connectivityOf(online, this.now())
    return this.last
  }
}
