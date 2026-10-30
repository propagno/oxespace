import { app } from 'electron'
import path from 'node:path'
import CodeGraph from '../vendor/codegraph/index'
import { isInitialized } from '../vendor/codegraph/directory'
import type { AppDatabase } from '../db'

/**
 * An open project holds a SQLite connection (page cache, memory map) and its parsed state. A project nobody
 * has asked about for this long is closed; opening it again syncs and costs about a second.
 */
const IDLE_CLOSE_MS = 10 * 60_000

export class CodeGraphService {
  private instances = new Map<string, CodeGraph>()
  private readonly lastUsed = new Map<string, number>()
  private readonly opening = new Map<string, Promise<CodeGraph>>()
  private sweep: ReturnType<typeof setInterval> | undefined

  constructor(private readonly db: AppDatabase) {
    // The vendored CodeGraph loads schema.sql + tree-sitter wasm from disk; in
    // the ESM main bundle its __dirname-relative lookups don't resolve, so point
    // it at where electron-vite copies those assets (<appPath>/out/main).
    if (!process.env.CODEGRAPH_ASSET_DIR) {
      process.env.CODEGRAPH_ASSET_DIR = path.join(app.getAppPath(), 'out', 'main')
    }
    // Opt-in: do NOT index on boot. CodeGraph (like RTK/Caveman/Semantic) is an
    // optional developer feature, so opening a workspace must not trigger a heavy
    // full-repo index. The graph is built lazily on the first
    // `oxespace_hybrid_explore` call for a workspace (see ensureInstance), and
    // cached in .oxe/codegraph.db thereafter.
  }

  /** 
   * Opens or creates a CodeGraph instance for the given project root.
   * If it's not initialized, it will initialize and start indexing.
   */
  public async ensureInstance(projectRoot: string): Promise<CodeGraph> {
    this.lastUsed.set(projectRoot, Date.now())
    const open = this.instances.get(projectRoot)
    if (open) return open
    // Concurrent callers share one open instead of each creating a connection.
    let pending = this.opening.get(projectRoot)
    if (!pending) {
      pending = this.open(projectRoot).finally(() => this.opening.delete(projectRoot))
      this.opening.set(projectRoot, pending)
    }
    return pending
  }

  /** Closes the projects nobody has used for a while. */
  public closeIdle(now = Date.now()): number {
    let closed = 0
    for (const [root, instance] of this.instances) {
      if (this.opening.has(root) || now - (this.lastUsed.get(root) ?? 0) < IDLE_CLOSE_MS) continue
      this.instances.delete(root); this.lastUsed.delete(root)
      try { instance.close(); closed++ } catch (e) { console.error(`[CodeGraphService] Error closing idle instance for ${root}:`, e) }
    }
    if (!this.instances.size && this.sweep) { clearInterval(this.sweep); this.sweep = undefined }
    return closed
  }

  private async open(projectRoot: string): Promise<CodeGraph> {
    try {
      if (!isInitialized(projectRoot)) {
        console.log(`[CodeGraphService] Initializing CodeGraph for ${projectRoot}...`)
        await CodeGraph.init(projectRoot, { index: true })
      }

      console.log(`[CodeGraphService] Opening CodeGraph for ${projectRoot}...`)
      // Pass sync:true to spin up the FileWatcher for hot reloading
      const instance = await CodeGraph.open(projectRoot, { sync: true })
      this.instances.set(projectRoot, instance)
      if (!this.sweep) { this.sweep = setInterval(() => this.closeIdle(), IDLE_CLOSE_MS / 2); this.sweep.unref?.() }
      return instance
    } catch (err) {
      console.error(`[CodeGraphService] Failed to initialize/open CodeGraph for ${projectRoot}:`, err)
      throw err
    }
  }

  /**
   * Retrieves an active instance, throwing if not available.
   * Generally you should use ensureInstance.
   */
  public getInstance(projectRoot: string): CodeGraph {
    const instance = this.instances.get(projectRoot)
    if (!instance) {
      throw new Error(`CodeGraph instance not open for ${projectRoot}`)
    }
    return instance
  }

  public async closeAll(): Promise<void> {
    if (this.sweep) { clearInterval(this.sweep); this.sweep = undefined }
    for (const [root, instance] of this.instances.entries()) {
      try {
        await instance.close()
      } catch (e) {
        console.error(`[CodeGraphService] Error closing instance for ${root}:`, e)
      }
    }
    this.instances.clear()
  }
}
