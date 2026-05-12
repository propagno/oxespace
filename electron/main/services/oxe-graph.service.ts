import { existsSync, statSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { OxeGraphParser } from './oxe-graph.parser'
import type { OxeExecutionGraph } from '../../../shared/types/oxe-graph'

interface CacheEntry {
  graph: OxeExecutionGraph
  planMtime: number
  specMtime: number
}

interface WatchEntry {
  watcher: FSWatcher
  timeout: NodeJS.Timeout | null
}

export class OxeGraphService {
  private readonly parser: OxeGraphParser
  private readonly graphCache = new Map<string, CacheEntry>()
  private readonly watchers = new Map<string, WatchEntry>()

  constructor(parser = new OxeGraphParser()) {
    this.parser = parser
  }

  buildGraph(rootPath: string): OxeExecutionGraph {
    const planPath = join(rootPath, '.oxe', 'PLAN.md')
    const specPath = join(rootPath, '.oxe', 'SPEC.md')
    const planMtime = mtime(planPath)
    const specMtime = mtime(specPath)

    const cached = this.graphCache.get(rootPath)
    if (cached && cached.planMtime === planMtime && cached.specMtime === specMtime) {
      return cached.graph
    }

    const graph = this.parser.build(rootPath)
    this.graphCache.set(rootPath, { graph, planMtime, specMtime })
    return graph
  }

  watchGraph(rootPath: string, emit: (graph: OxeExecutionGraph) => void): void {
    if (this.watchers.has(rootPath)) return
    const oxeDir = join(rootPath, '.oxe')
    if (!existsSync(oxeDir)) return

    const watcher = watch(oxeDir, { recursive: true }, () => {
      const entry = this.watchers.get(rootPath)
      if (!entry) return
      if (entry.timeout) clearTimeout(entry.timeout)
      entry.timeout = setTimeout(() => {
        this.graphCache.delete(rootPath)
        emit(this.buildGraph(rootPath))
      }, 200)
    })

    this.watchers.set(rootPath, { watcher, timeout: null })
  }

  stopWatching(rootPath: string): void {
    const entry = this.watchers.get(rootPath)
    if (!entry) return
    if (entry.timeout) clearTimeout(entry.timeout)
    entry.watcher.close()
    this.watchers.delete(rootPath)
  }

  closeAll(): void {
    for (const rootPath of [...this.watchers.keys()]) {
      this.stopWatching(rootPath)
    }
  }
}

function mtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}
