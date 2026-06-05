import { app } from 'electron'
import path from 'node:path'
import CodeGraph from '../vendor/codegraph/index'
import { isInitialized } from '../vendor/codegraph/directory'
import type { AppDatabase } from '../db'

export class CodeGraphService {
  private instances = new Map<string, typeof CodeGraph>()

  constructor(private readonly db: AppDatabase) {
    // The vendored CodeGraph loads schema.sql + tree-sitter wasm from disk; in
    // the ESM main bundle its __dirname-relative lookups don't resolve, so point
    // it at where electron-vite copies those assets (<appPath>/out/main).
    if (!process.env.CODEGRAPH_ASSET_DIR) {
      process.env.CODEGRAPH_ASSET_DIR = path.join(app.getAppPath(), 'out', 'main')
    }
    // We could listen to workspace changes to open/close instances,
    // but CodeGraph is fast enough to just open lazily.
    // For hot reload, we will initialize the active workspace immediately.
    this.bootstrapActiveWorkspace()
  }

  /** Watch the workspace flagged active in the DB, so indexing begins at launch. */
  private bootstrapActiveWorkspace(): void {
    try {
      const row = this.db
        .prepare('SELECT id, root_path FROM workspaces WHERE is_active = 1 LIMIT 1')
        .get() as { id?: string; root_path?: string } | undefined
      if (row?.root_path) {
        this.ensureInstance(row.root_path).catch(err => {
          console.error(`[CodeGraphService] Error bootstrapping workspace:`, err)
        })
      }
    } catch {
      // Table may be absent during very early boot
    }
  }

  /** 
   * Opens or creates a CodeGraph instance for the given project root.
   * If it's not initialized, it will initialize and start indexing.
   */
  public async ensureInstance(projectRoot: string): Promise<typeof CodeGraph> {
    if (this.instances.has(projectRoot)) {
      return this.instances.get(projectRoot)!
    }

    try {
      if (!isInitialized(projectRoot)) {
        console.log(`[CodeGraphService] Initializing CodeGraph for ${projectRoot}...`)
        await CodeGraph.init(projectRoot, { index: true })
      }

      console.log(`[CodeGraphService] Opening CodeGraph for ${projectRoot}...`)
      // Pass sync:true to spin up the FileWatcher for hot reloading
      const instance = await CodeGraph.open(projectRoot, { sync: true })
      this.instances.set(projectRoot, instance as any)
      return instance as any
    } catch (err) {
      console.error(`[CodeGraphService] Failed to initialize/open CodeGraph for ${projectRoot}:`, err)
      throw err
    }
  }

  /**
   * Retrieves an active instance, throwing if not available.
   * Generally you should use ensureInstance.
   */
  public getInstance(projectRoot: string): typeof CodeGraph {
    const instance = this.instances.get(projectRoot)
    if (!instance) {
      throw new Error(`CodeGraph instance not open for ${projectRoot}`)
    }
    return instance
  }

  public async closeAll(): Promise<void> {
    for (const [root, instance] of this.instances.entries()) {
      try {
        await (instance as any).close()
      } catch (e) {
        console.error(`[CodeGraphService] Error closing instance for ${root}:`, e)
      }
    }
    this.instances.clear()
  }
}
