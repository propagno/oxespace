import { app } from 'electron'
import path from 'node:path'
import CodeGraph from '../vendor/codegraph/index'
import { isInitialized } from '../vendor/codegraph/directory'
import type { AppDatabase } from '../db'

export class CodeGraphService {
  private instances = new Map<string, CodeGraph>()

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
      this.instances.set(projectRoot, instance)
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
