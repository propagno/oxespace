import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as https from 'node:https'
import * as fs from 'node:fs/promises'
import log from 'electron-log'

const execFileAsync = promisify(execFile)

/**
 * Downloads a file from a URL, following redirects.
 */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const request = https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
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

export class RtkService {
  private readonly binDir: string
  private downloadPromise: Promise<string> | null = null

  constructor() {
    this.binDir = join(app.getPath('userData'), 'bin')
    if (!existsSync(this.binDir)) {
      mkdirSync(this.binDir, { recursive: true })
    }
  }

  /**
   * Ensures RTK is downloaded and available in the local bin directory.
   * Returns the directory containing the RTK executable so it can be added to PATH.
   */
  async ensureRtk(): Promise<string> {
    const exeName = process.platform === 'win32' ? 'rtk.exe' : 'rtk'
    const exePath = join(this.binDir, exeName)

    if (existsSync(exePath)) {
      return this.binDir
    }

    if (this.downloadPromise) {
      return this.downloadPromise
    }

    this.downloadPromise = this.downloadRtk().then(() => this.binDir)
    try {
      await this.downloadPromise
      return this.binDir
    } finally {
      this.downloadPromise = null
    }
  }

  private async downloadRtk(): Promise<void> {
    log.info('[RtkService] Downloading RTK binary...')
    
    let url = ''
    let isZip = false
    
    if (process.platform === 'win32') {
      url = 'https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-pc-windows-msvc.zip'
      isZip = true
    } else if (process.platform === 'darwin') {
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
      url = `https://github.com/rtk-ai/rtk/releases/latest/download/rtk-${arch}-apple-darwin.tar.gz`
    } else {
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
      const triple = arch === 'aarch64' ? 'unknown-linux-gnu' : 'unknown-linux-musl'
      url = `https://github.com/rtk-ai/rtk/releases/latest/download/rtk-${arch}-${triple}.tar.gz`
    }

    const archivePath = join(this.binDir, isZip ? 'rtk.zip' : 'rtk.tar.gz')

    try {
      await downloadFile(url, archivePath)
      log.info('[RtkService] RTK archive downloaded, extracting...')

      if (isZip) {
        await execFileAsync('powershell', ['-Command', `Expand-Archive -Path "${archivePath}" -DestinationPath "${this.binDir}" -Force`])
      } else {
        await execFileAsync('tar', ['-xzf', archivePath, '-C', this.binDir])
      }

      // If extraction created a subfolder, we assume the zip/tar was flat based on RTK releases.
      // But let's verify rtk exists.
      const exeName = process.platform === 'win32' ? 'rtk.exe' : 'rtk'
      const exePath = join(this.binDir, exeName)
      
      if (!existsSync(exePath)) {
        throw new Error(`Extracted, but ${exeName} not found in ${this.binDir}`)
      }

      if (process.platform !== 'win32') {
        await fs.chmod(exePath, 0o755)
      }

      log.info('[RtkService] RTK downloaded and extracted successfully.')
    } catch (error) {
      log.error('[RtkService] Failed to download or extract RTK', error)
      throw error
    } finally {
      // Cleanup archive
      if (existsSync(archivePath)) {
        await fs.unlink(archivePath).catch(() => {})
      }
    }
  }
}
