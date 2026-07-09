import { join } from 'node:path'
import { existsSync, mkdirSync, createWriteStream, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as https from 'node:https'
import * as fs from 'node:fs/promises'
import log from 'electron-log'
import type { RtkUpdateState } from '../../../shared/types/updater'

const execFileAsync = promisify(execFile)

const RTK_REPO = 'rtk-ai/rtk'
/** Don't hammer GitHub Releases more than once per this window (background). */
const CHECK_TTL_MS = 6 * 60 * 60 * 1000

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const request = https.get(url, { headers: { 'User-Agent': 'OXESpace' } }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
        if (!response.headers.location) {
          reject(new Error('Redirect with no location header'))
          return
        }
        downloadFile(response.headers.location, dest).then(resolve).catch(reject)
        return
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download, status code: ${response.statusCode}`))
        return
      }
      response.pipe(file)
      file.on('finish', () => {
        file.close(() => resolve())
      })
    })
    request.on('error', (err) => {
      fs.unlink(dest).catch(() => {})
      reject(err)
    })
  })
}

function httpsJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'OXESpace',
        Accept: 'application/vnd.github+json'
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        if (!res.headers.location) {
          reject(new Error('Redirect with no location'))
          return
        }
        httpsJson<T>(res.headers.location).then(resolve).catch(reject)
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(Buffer.from(c)))
      res.on('end', () => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`GitHub API ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)
        } catch (err) {
          reject(err)
        }
      })
    }).on('error', reject)
  })
}

/** Shared instance so terminal start + Settings IPC share download/check state. */
let sharedRtkService: RtkService | null = null

export function getRtkService(userDataPath: string): RtkService {
  if (!sharedRtkService) sharedRtkService = new RtkService(userDataPath)
  return sharedRtkService
}

export class RtkService {
  private _binDir: string | null = null
  private downloadPromise: Promise<string> | null = null
  private checkPromise: Promise<RtkUpdateState> | null = null
  private lastCheckAt = 0
  private latestVersionCache: string | null = null
  private lastError: string | null = null
  private updating = false
  private readonly userDataPath: string

  constructor(userDataPath: string) {
    this.userDataPath = userDataPath
  }

  private get binDir(): string {
    if (!this._binDir) {
      this._binDir = join(this.userDataPath, 'bin')
      if (!existsSync(this._binDir)) {
        mkdirSync(this._binDir, { recursive: true })
      }
    }
    return this._binDir
  }

  private get exeName(): string {
    return process.platform === 'win32' ? 'rtk.exe' : 'rtk'
  }

  private get exePath(): string {
    return join(this.binDir, this.exeName)
  }

  private get versionPath(): string {
    return join(this.binDir, 'rtk.version')
  }

  private readInstalledVersion(): string | null {
    try {
      if (!existsSync(this.versionPath)) return null
      const v = readFileSync(this.versionPath, 'utf8').trim()
      return v || null
    } catch {
      return null
    }
  }

  private writeInstalledVersion(version: string): void {
    writeFileSync(this.versionPath, `${version}\n`, 'utf8')
  }

  getStatus(): RtkUpdateState {
    const installed = existsSync(this.exePath)
    const version = this.readInstalledVersion()
    const latestVersion = this.latestVersionCache
    const updateAvailable = Boolean(
      installed &&
      latestVersion &&
      version &&
      normalizeTag(latestVersion) !== normalizeTag(version)
    ) || Boolean(installed && latestVersion && !version) // legacy install without version file
    return {
      installed,
      version,
      latestVersion,
      updateAvailable: updateAvailable || Boolean(!installed && latestVersion),
      binDir: this.binDir,
      error: this.lastError,
      checking: this.checkPromise !== null,
      updating: this.updating || this.downloadPromise !== null,
      lastCheckedAt: this.lastCheckAt || null
    }
  }

  /**
   * Ensures RTK is present. Optionally re-checks GitHub for a newer release
   * (throttled unless forceCheck). Used when starting agent terminals.
   */
  async ensureRtk(options: { forceCheck?: boolean } = {}): Promise<string> {
    const forceCheck = options.forceCheck === true
    if (existsSync(this.exePath)) {
      // Background version check — don't block terminal start.
      if (forceCheck || Date.now() - this.lastCheckAt > CHECK_TTL_MS) {
        void this.checkForUpdate(forceCheck).then(async (s) => {
          if (s.updateAvailable) {
            try {
              await this.updateToLatest()
            } catch (err) {
              log.warn('[RtkService] background update failed', err)
            }
          }
        })
      }
      return this.binDir
    }

    if (this.downloadPromise) return this.downloadPromise

    this.downloadPromise = this.downloadRtk(null).then(() => this.binDir)
    try {
      await this.downloadPromise
      return this.binDir
    } finally {
      this.downloadPromise = null
    }
  }

  async checkForUpdate(force = false): Promise<RtkUpdateState> {
    if (this.checkPromise) return this.checkPromise
    if (!force && Date.now() - this.lastCheckAt < CHECK_TTL_MS && this.latestVersionCache) {
      return this.getStatus()
    }

    this.checkPromise = (async () => {
      this.lastError = null
      try {
        const release = await httpsJson<{ tag_name?: string }>(
          `https://api.github.com/repos/${RTK_REPO}/releases/latest`
        )
        const tag = release.tag_name?.trim() || null
        this.latestVersionCache = tag
        this.lastCheckAt = Date.now()
        log.info('[RtkService] latest release', tag)
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err)
        log.warn('[RtkService] check failed', this.lastError)
      }
      return this.getStatus()
    })()

    try {
      return await this.checkPromise
    } finally {
      this.checkPromise = null
    }
  }

  async updateToLatest(): Promise<RtkUpdateState> {
    this.updating = true
    this.lastError = null
    try {
      const status = await this.checkForUpdate(true)
      const target = status.latestVersion
      if (!target) {
        throw new Error(status.error ?? 'Could not resolve latest RTK version')
      }
      const local = this.readInstalledVersion()
      if (existsSync(this.exePath) && local && normalizeTag(local) === normalizeTag(target)) {
        return this.getStatus()
      }
      if (this.downloadPromise) {
        await this.downloadPromise
        return this.getStatus()
      }
      this.downloadPromise = this.downloadRtk(target).then(() => this.binDir)
      await this.downloadPromise
      return this.getStatus()
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      this.downloadPromise = null
      this.updating = false
    }
  }

  private async downloadRtk(versionTag: string | null): Promise<void> {
    log.info('[RtkService] Downloading RTK binary...', versionTag ?? 'latest')

    let url = ''
    let isZip = false

    if (process.platform === 'win32') {
      url = `https://github.com/${RTK_REPO}/releases/latest/download/rtk-x86_64-pc-windows-msvc.zip`
      isZip = true
    } else if (process.platform === 'darwin') {
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
      url = `https://github.com/${RTK_REPO}/releases/latest/download/rtk-${arch}-apple-darwin.tar.gz`
    } else {
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
      const triple = arch === 'aarch64' ? 'unknown-linux-gnu' : 'unknown-linux-musl'
      url = `https://github.com/${RTK_REPO}/releases/latest/download/rtk-${arch}-${triple}.tar.gz`
    }

    // Prefer explicit tag asset URL when we know the version.
    if (versionTag) {
      const tag = versionTag.startsWith('v') ? versionTag : versionTag
      if (process.platform === 'win32') {
        url = `https://github.com/${RTK_REPO}/releases/download/${tag}/rtk-x86_64-pc-windows-msvc.zip`
      } else if (process.platform === 'darwin') {
        const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
        url = `https://github.com/${RTK_REPO}/releases/download/${tag}/rtk-${arch}-apple-darwin.tar.gz`
      } else {
        const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
        const triple = arch === 'aarch64' ? 'unknown-linux-gnu' : 'unknown-linux-musl'
        url = `https://github.com/${RTK_REPO}/releases/download/${tag}/rtk-${arch}-${triple}.tar.gz`
      }
    }

    const archivePath = join(this.binDir, isZip ? 'rtk.zip' : 'rtk.tar.gz')
    const stagingDir = join(this.binDir, '.rtk-staging')
    try {
      await fs.rm(stagingDir, { recursive: true, force: true })
      await fs.mkdir(stagingDir, { recursive: true })
      await downloadFile(url, archivePath)
      log.info('[RtkService] RTK archive downloaded, extracting...')

      if (isZip) {
        await execFileAsync('tar', ['-xf', archivePath, '-C', stagingDir])
      } else {
        await execFileAsync('tar', ['-xzf', archivePath, '-C', stagingDir])
      }

      const stagedExe = join(stagingDir, this.exeName)
      if (!existsSync(stagedExe)) {
        // Some archives nest a single folder.
        const entries = await fs.readdir(stagingDir)
        const nested = entries
          .map((e) => join(stagingDir, e, this.exeName))
          .find((p) => existsSync(p))
        if (!nested) throw new Error(`Extracted, but ${this.exeName} not found`)
        await fs.copyFile(nested, stagedExe)
      }

      if (process.platform !== 'win32') {
        await fs.chmod(stagedExe, 0o755)
      }

      // Atomic-ish replace: move old aside, move new in.
      const finalExe = this.exePath
      const backup = `${finalExe}.bak`
      try {
        if (existsSync(backup)) unlinkSync(backup)
        if (existsSync(finalExe)) renameSync(finalExe, backup)
        renameSync(stagedExe, finalExe)
        if (existsSync(backup)) unlinkSync(backup)
      } catch (err) {
        // Windows may lock the running binary — leave .bak and copy over.
        await fs.copyFile(stagedExe, finalExe)
      }

      const resolvedVersion = versionTag
        ?? this.latestVersionCache
        ?? (await this.checkForUpdate(true).then((s) => s.latestVersion))
        ?? 'unknown'
      this.writeInstalledVersion(resolvedVersion)
      this.latestVersionCache = resolvedVersion
      this.lastCheckAt = Date.now()
      log.info('[RtkService] RTK installed', resolvedVersion)
    } catch (error) {
      log.error('[RtkService] Failed to download or extract RTK', error)
      throw error
    } finally {
      if (existsSync(archivePath)) {
        await fs.unlink(archivePath).catch(() => {})
      }
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^v/i, '').toLowerCase()
}
