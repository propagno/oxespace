import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type { AppDatabase } from '../db'
import chokidar, { FSWatcher } from 'chokidar'
import { makeIgnoreFilter } from './semantic-ignore'
import { bestChunkScore, bestChunkScoreBlobWithIndex, CHUNK_CHARS, CHUNK_OVERLAP, chunkSourceText, encodeEmbeddings, type SemanticSourceChunk } from './semantic-chunk'
import { PASSAGE_PREFIX, QUERY_PREFIX, SEMANTIC_MODEL_ID } from './semantic-model'
import type { SemanticConfidence, SemanticLastQuery, SemanticLogEntry, SemanticLogLevel, SemanticSearchMode } from '../../../shared/types/ipc'
import {
  buildFtsQuery,
  buildLexicalDocument,
  classifySemanticFile,
  estimateRetrievalConfidence,
  fuseRetrievalCandidates,
  resolveSemanticSearchMode,
  sanitizeSemanticContent,
  shouldExpandAutomaticRetrieval,
  tokenizeSemanticQuery,
  type FusedRetrievalCandidate,
  type ResolvedSemanticSearchMode
} from './semantic-retrieval'

export interface SemanticStatus {
  enabled: boolean
  workerReady: boolean
  indexing: boolean
  count: number
  lastError: string | null
  /** Embedding model id (e.g. Xenova/multilingual-e5-small). */
  modelId: string
  mode: SemanticSearchMode
  coverage: {
    lexicalDocuments: number
    lastIndexedAt: number | null
    byCategory: { source: number; test: number; config: number; docs: number; other: number }
  }
  lastQuery: SemanticLastQuery | null
}

export interface SemanticQueryOptions {
  limit?: number
  mode?: SemanticSearchMode
  /** Hard ceiling for source context returned to the agent. */
  maxTokens?: number
}

export interface SemanticQueryMatch extends FusedRetrievalCandidate {
  snippet: string
  lineStart: number
  lineEnd: number
  estimatedTokens: number
  fullFileEstimatedTokens: number
}

export interface SemanticQueryReport {
  query: string
  requestedMode: SemanticSearchMode
  resolvedMode: ResolvedSemanticSearchMode
  confidence: SemanticConfidence
  expanded: boolean
  expansionReason: string | null
  results: SemanticQueryMatch[]
  coverage: {
    indexedFiles: number
    semanticCandidates: number
    lexicalCandidates: number
    searchedFullLexicalIndex: boolean
    truncated: boolean
    excluded: string[]
  }
  estimatedTokens: number
  estimatedFullFileTokens: number
  estimatedSavingsPercent: number
  durationMs: number
  warning: string | null
}

export interface SemanticServiceOptions {
  /** Broadcast a log line to the renderer (see registerSemanticIpc / index.ts). */
  emitLog?: (entry: SemanticLogEntry) => void
}

/** How many recent log lines to retain for the Tools → Semantic Activity panel. */
const LOG_RING_SIZE = 1000

// Only embed source/text files. Embedding binaries or huge assets wastes the
// worker and pollutes results, so the watcher is broad but indexing is filtered.
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx', '.txt',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.php', '.swift', '.scala', '.sh', '.bash', '.ps1', '.sql', '.html',
  '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.yml', '.yaml', '.toml'
])
const INDEXABLE_BASENAMES = new Set([
  'dockerfile', 'makefile', 'procfile', 'gemfile', 'rakefile', 'license',
  '.env', '.env.local', '.env.development', '.env.production', '.npmrc',
  '.eslintrc', '.prettierrc', '.babelrc', 'yarn.lock'
])
const MAX_INDEXABLE_BYTES = 256 * 1024
const EMBED_TIMEOUT_MS = 30_000
/** Delay before the boot-time crawl of the active workspace, so the initial
 *  chokidar scan doesn't compete with first paint / terminal startup. */
const BOOTSTRAP_WATCH_DELAY_MS = 4_000
const RETRIEVAL_INDEX_VERSION = 3

function isIndexableFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase()
  return CODE_EXTENSIONS.has(path.extname(base)) || INDEXABLE_BASENAMES.has(base) || base.startsWith('.env.')
}

function parseChunkMetadata(value: unknown, index: number): {
  bestChunkStart?: number
  bestChunkEnd?: number
  bestChunkLineStart?: number
  bestChunkLineEnd?: number
  bestChunkKind?: SemanticSourceChunk['kind']
  bestChunkName?: string
} {
  try {
    const parsed = JSON.parse(typeof value === 'string' ? value : '[]') as unknown
    if (!Array.isArray(parsed)) return {}
    const item = parsed[index] as Partial<SemanticSourceChunk> | undefined
    if (!item || !Number.isFinite(item.start) || !Number.isFinite(item.end)) return {}
    return {
      bestChunkStart: item.start,
      bestChunkEnd: item.end,
      bestChunkLineStart: Number.isFinite(item.lineStart) ? item.lineStart : undefined,
      bestChunkLineEnd: Number.isFinite(item.lineEnd) ? item.lineEnd : undefined,
      bestChunkKind: item.kind === 'symbol' || item.kind === 'section' || item.kind === 'window' ? item.kind : undefined,
      bestChunkName: typeof item.name === 'string' ? item.name : undefined
    }
  } catch {
    return {}
  }
}

export class SemanticService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void, timer: NodeJS.Timeout }>();
  private watchers = new Map<string, FSWatcher>();
  /** Recorded workspace roots so a toggle can (re)start watching on demand. */
  private roots = new Map<string, string>();
  /** Per-workspace enabled flag. Absent = enabled (default-on). */
  private enabled = new Map<string, boolean>();
  /** Retrieval policy selected in Tools → Semantic Activity (default adaptive). */
  private modes = new Map<string, SemanticSearchMode>();
  /** Last query report summary, surfaced as an observable quality signal. */
  private lastQueries = new Map<string, SemanticLastQuery>();
  private coverageCache = new Map<string, { at: number; value: SemanticStatus['coverage'] }>();
  /** In-flight embedding count per workspace, for the "indexing" status. */
  private indexingCount = new Map<string, number>();
  /** Serializes file indexing so the single worker isn't flooded (see startWatching). */
  private indexChain: Promise<void> = Promise.resolve();
  private workerReady = false;
  private lastError: string | null = null;
  /** Callers blocked in getEmbedding waiting for the model to finish loading. */
  private readyWaiters: { resolve: () => void; reject: (err: Error) => void }[] = [];
  /** Rolling activity log surfaced via Tools → Semantic Activity. */
  private logs: SemanticLogEntry[] = [];
  private readonly emitLog?: (entry: SemanticLogEntry) => void;
  /** Deferred boot-crawl timer; cleared in destroy() so it can't fire post-teardown. */
  private bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set in destroy() so the deferred bootstrap can't touch a closed DB. */
  private destroyed = false;

  constructor(private readonly db: AppDatabase, options: SemanticServiceOptions = {}) {
    this.emitLog = options.emitLog;
    this.log('info', `Semantic engine starting · model ${SEMANTIC_MODEL_ID}`);
    this.initWorker();
    // Start indexing the already-active workspace on boot. The renderer only
    // calls workspace.setActive when the user *switches* workspaces, so without
    // this the active workspace on launch would never get watched and the index
    // would stay empty.
    //
    // Deferred a few seconds: the initial chokidar crawl (ignoreInitial:false)
    // fans out fs-stat + per-file DB lookups that compete with first paint and
    // terminal startup on large repos. unref() so it never keeps the process
    // alive on its own.
    this.bootstrapTimer = setTimeout(() => {
      this.bootstrapTimer = null;
      if (this.destroyed) return;
      this.bootstrapActiveWorkspace();
    }, BOOTSTRAP_WATCH_DELAY_MS);
    this.bootstrapTimer.unref?.();
  }

  /**
   * Append a line to the activity log (ring-buffered) and broadcast it. This is
   * the single place semantic processing is made observable to the user, so the
   * Tools panel and the console stay in sync.
   */
  private log(level: SemanticLogLevel, message: string, meta?: { workspaceId?: string; file?: string }): void {
    const entry: SemanticLogEntry = { ts: Date.now(), level, message, ...meta };
    this.logs.push(entry);
    if (this.logs.length > LOG_RING_SIZE) this.logs.splice(0, this.logs.length - LOG_RING_SIZE);
    try { this.emitLog?.(entry); } catch { /* renderer gone */ }
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](`[SemanticService] ${message}`);
  }

  /** Recent activity log lines (oldest first) for the Tools panel. */
  public getLogs(): SemanticLogEntry[] {
    return [...this.logs];
  }

  /** Watch the workspace flagged active in the DB, so indexing begins at launch. */
  private bootstrapActiveWorkspace(): void {
    try {
      const row = this.db
        .prepare('SELECT id, root_path FROM workspaces WHERE is_active = 1 LIMIT 1')
        .get() as { id?: string; root_path?: string } | undefined
      if (row?.id && row.root_path) this.watchWorkspace(row.id, row.root_path)
    } catch {
      // Table may be absent during very early boot; the renderer's setEnabled
      // call will start watching once it mounts.
    }
  }

  private initWorker() {
    try {
      // Resolve the worker via app.getAppPath() (= app root in dev, app.asar in
      // prod) rather than __dirname: the main bundle is ESM (package.json
      // "type":"module"), and electron-vite does not rewrite __dirname inside
      // imported modules, so a bare __dirname is undefined here at runtime and
      // the worker silently fails to start. out/main/semantic-worker.js sits
      // under the app path in both dev and packaged builds.
      const workerPath = path.join(app.getAppPath(), 'out', 'main', 'semantic-worker.js');

      // The transformers.js model cache must live somewhere writable. Inside a
      // packaged build node_modules sits in a read-only asar, so point the cache
      // at userData and pass it to the worker (a plain Node thread with no access
      // to electron's `app`).
      const cacheDir = path.join(app.getPath('userData'), 'models');
      try { mkdirSync(cacheDir, { recursive: true }); } catch { /* best effort */ }

      // Model bundled with the app (offline-first). Packaged: <resources>/models;
      // dev: <repo>/resources/models (populated by scripts/fetch-semantic-model.mjs).
      const localModelPath = app.isPackaged
        ? path.join(process.resourcesPath, 'models')
        : path.join(app.getAppPath(), 'resources', 'models');

      this.worker = new Worker(workerPath, { workerData: { cacheDir, localModelPath } });
      this.log('info', `Loading embedding model (bundled at ${localModelPath}; cache ${cacheDir}) …`);

      this.worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          this.workerReady = true;
          this.lastError = null;
          this.flushReadyWaiters();
          this.log('info', 'Model loaded and ready.');
        } else if (msg.type === 'result' || msg.type === 'error') {
          if (msg.type === 'error' && !msg.id) {
            // An init-time error (e.g. model failed to load) carries no request id.
            this.lastError = msg.error;
            this.workerReady = false;
            this.rejectReadyWaiters(new Error(msg.error));
            this.log('error', `Model failed to load: ${msg.error}`);
            return;
          }
          const pending = this.pendingRequests.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            if (msg.type === 'error') pending.reject(new Error(msg.error));
            else pending.resolve(msg.embedding);
            this.pendingRequests.delete(msg.id);
          }
        }
      });

      this.worker.on('error', (err) => {
        this.workerReady = false;
        this.lastError = err instanceof Error ? err.message : String(err);
        const error = err instanceof Error ? err : new Error(String(err));
        this.rejectAllPending(error);
        this.rejectReadyWaiters(error);
        this.log('error', `Worker error: ${this.lastError}`);
      });

      this.worker.on('exit', (code) => {
        this.workerReady = false;
        const error = new Error(`Semantic worker exited (code ${code})`);
        this.rejectAllPending(error);
        this.rejectReadyWaiters(error);
        this.log('warn', `Worker stopped (exit code ${code}).`);
      });

      // Send init command
      this.worker.postMessage({ type: 'init' });

    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.log('error', `Failed to initialize worker: ${this.lastError}`);
    }
  }

  private rejectAllPending(err: Error) {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  private flushReadyWaiters() {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w.resolve();
  }

  private rejectReadyWaiters(err: Error) {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w.reject(err);
  }

  /**
   * Resolve once the worker's model has loaded. The initial directory scan can
   * emit `add` events before the model finishes loading; without this gate those
   * embeds would fail with "Model not initialized" and the files would silently
   * never be indexed.
   */
  private waitForReady(): Promise<void> {
    if (this.workerReady) return Promise.resolve();
    if (this.lastError) return Promise.reject(new Error(this.lastError));
    return new Promise<void>((resolve, reject) => {
      this.readyWaiters.push({ resolve, reject });
    });
  }

  public async getEmbedding(text: string): Promise<number[]> {
    if (!this.worker) throw new Error('Worker not initialized');
    await this.waitForReady();

    return new Promise((resolve, reject) => {
      const id = randomUUID();
      // Guard against a hung/crashed worker leaving the promise pending forever.
      const timer = setTimeout(() => {
        if (this.pendingRequests.delete(id)) {
          reject(new Error('Semantic embedding timed out'));
        }
      }, EMBED_TIMEOUT_MS);
      timer.unref?.();
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ type: 'embed', id, text });
    });
  }

  /**
   * Opt-in: off until the renderer/user explicitly enables it (default-off).
   * This keeps boot from auto-indexing — the renderer mirrors the user's chip
   * preference via setEnabled, and the MCP tool reports disabled until then.
   */
  public isEnabled(workspaceId: string): boolean {
    return this.enabled.get(workspaceId) ?? false;
  }

  /**
   * Toggle the feature for a workspace. Disabling stops indexing immediately;
   * enabling resumes watching the recorded root. Driven from the renderer so the
   * main-process indexing/tool respect the user's per-workspace preference.
   */
  public setEnabled(workspaceId: string, enabled: boolean, rootPath?: string) {
    const wasEnabled = this.enabled.get(workspaceId);
    this.enabled.set(workspaceId, enabled);
    if (rootPath) this.roots.set(workspaceId, rootPath);
    if (enabled) {
      // The renderer toggle calls this without a rootPath, so fall back to the
      // workspace's recorded root (resolved from the DB if not already cached).
      const root = this.resolveRoot(workspaceId);
      if (root) this.startWatching(workspaceId, root);
    } else {
      if (wasEnabled === true) {
        this.log('info', 'Semantic search disabled for workspace.', { workspaceId });
        this.stopWatching(workspaceId);
      }
    }
  }

  public setMode(workspaceId: string, mode: SemanticSearchMode): void {
    this.modes.set(workspaceId, mode)
    this.log('info', `Retrieval mode set to ${mode}.`, { workspaceId })
  }

  public getMode(workspaceId: string): SemanticSearchMode {
    return this.modes.get(workspaceId) ?? 'auto'
  }

  /** Recorded root for the workspace, falling back to the DB row. */
  private resolveRoot(workspaceId: string): string | null {
    const cached = this.roots.get(workspaceId);
    if (cached) return cached;
    try {
      const row = this.db
        .prepare('SELECT root_path FROM workspaces WHERE id = ?')
        .get(workspaceId) as { root_path?: string } | undefined;
      if (row?.root_path) {
        this.roots.set(workspaceId, row.root_path);
        return row.root_path;
      }
    } catch {
      // Table may be absent during early boot.
    }
    return null;
  }

  public watchWorkspace(workspaceId: string, rootPath: string) {
    this.roots.set(workspaceId, rootPath);
    if (!this.isEnabled(workspaceId)) return;
    this.startWatching(workspaceId, rootPath);
  }

  private startWatching(workspaceId: string, rootPath: string) {
    if (this.watchers.has(workspaceId)) return;

    this.log('info', `Watching workspace for indexing: ${rootPath}`, { workspaceId });
    const watcher = chokidar.watch(rootPath, {
      // Ignore heavy/irrelevant directories and dotfiles. Per-file extension
      // filtering happens in queueFileForEmbedding so directories aren't dropped
      // by an extension test.
      ignored: makeIgnoreFilter(rootPath),
      persistent: true,
      ignoreInitial: false
    });

    // Serialize indexing through a single chain. The initial scan emits `add`
    // for every file at once; without this they'd all post embed requests
    // concurrently, and since the embed timeout starts at enqueue (not when the
    // single worker actually picks the request up) the backlog would time out en
    // masse — especially while CodeGraph's parser also competes for CPU.
    watcher.on('add', (filePath) => this.enqueueIndex(workspaceId, filePath));
    watcher.on('change', (filePath) => this.enqueueIndex(workspaceId, filePath));
    watcher.on('unlink', (filePath) => {
      try {
        this.db.prepare('DELETE FROM semantic_embeddings WHERE workspace_id = ? AND file_path = ?').run(workspaceId, filePath);
        this.db.prepare('DELETE FROM semantic_documents WHERE workspace_id = ? AND file_path = ?').run(workspaceId, filePath);
        this.coverageCache.delete(workspaceId)
      } catch { /* table may be absent during early boot */ }
    });

    this.watchers.set(workspaceId, watcher);
  }

  private stopWatching(workspaceId: string) {
    const watcher = this.watchers.get(workspaceId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(workspaceId);
    }
  }

  public unwatchWorkspace(workspaceId: string) {
    this.stopWatching(workspaceId);
    this.roots.delete(workspaceId);
    this.enabled.delete(workspaceId);
    this.modes.delete(workspaceId);
    this.lastQueries.delete(workspaceId);
    this.coverageCache.delete(workspaceId);
    this.indexingCount.delete(workspaceId);
  }

  public getStatus(workspaceId: string): SemanticStatus {
    let count = 0;
    let coverage = this.coverageCache.get(workspaceId)?.value ?? {
      lexicalDocuments: 0,
      lastIndexedAt: null,
      byCategory: { source: 0, test: 0, config: 0, docs: 0, other: 0 }
    };
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM semantic_embeddings WHERE workspace_id = ?').get(workspaceId) as { n: number } | undefined;
      count = row?.n ?? 0;
      const cached = this.coverageCache.get(workspaceId)
      if (!cached || Date.now() - cached.at > 15_000) {
        const docs = this.db.prepare('SELECT file_path, updated_at FROM semantic_documents WHERE workspace_id = ?').all(workspaceId) as Array<{ file_path: string; updated_at: number }>;
        const byCategory = { source: 0, test: 0, config: 0, docs: 0, other: 0 }
        let lastIndexedAt: number | null = null
        for (const doc of docs) {
          byCategory[classifySemanticFile(doc.file_path)]++
          if (lastIndexedAt === null || doc.updated_at > lastIndexedAt) lastIndexedAt = doc.updated_at
        }
        coverage = { lexicalDocuments: docs.length, lastIndexedAt, byCategory }
        this.coverageCache.set(workspaceId, { at: Date.now(), value: coverage })
      }
    } catch { /* table may not exist yet */ }
    return {
      enabled: this.isEnabled(workspaceId),
      workerReady: this.workerReady,
      indexing: (this.indexingCount.get(workspaceId) ?? 0) > 0,
      count,
      lastError: this.lastError,
      modelId: SEMANTIC_MODEL_ID,
      mode: this.getMode(workspaceId),
      coverage,
      lastQuery: this.lastQueries.get(workspaceId) ?? null
    };
  }

  /**
   * Drop stored embeddings for a workspace and re-crawl the root (if enabled).
   * Used from Tools → Semantic Activity "Reindex".
   */
  public reindex(workspaceId: string): SemanticStatus {
    const root = this.resolveRoot(workspaceId)
    this.stopWatching(workspaceId)
    try {
      this.db.prepare('DELETE FROM semantic_embeddings WHERE workspace_id = ?').run(workspaceId)
      this.db.prepare('DELETE FROM semantic_documents WHERE workspace_id = ?').run(workspaceId)
      this.coverageCache.delete(workspaceId)
      this.log('info', 'Semantic index cleared — re-crawling workspace.', { workspaceId })
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.log('error', `Reindex failed clearing rows: ${this.lastError}`, { workspaceId })
      return this.getStatus(workspaceId)
    }
    this.indexingCount.set(workspaceId, 0)
    if (this.isEnabled(workspaceId) && root) {
      this.startWatching(workspaceId, root)
    } else if (!this.isEnabled(workspaceId)) {
      this.log('info', 'Semantic is disabled — enable the chip to re-index after clear.', { workspaceId })
    } else {
      this.log('warn', 'No workspace root recorded — cannot re-crawl.', { workspaceId })
    }
    return this.getStatus(workspaceId)
  }

  /** Append a file to the serialized index chain (one file embedded at a time). */
  private enqueueIndex(workspaceId: string, filePath: string): void {
    this.indexChain = this.indexChain.then(() => this.queueFileForEmbedding(workspaceId, filePath));
  }

  private async queueFileForEmbedding(workspaceId: string, filePath: string) {
    // Skip files we don't want to embed before doing any work.
    if (!isIndexableFile(filePath)) return;
    if (!this.isEnabled(workspaceId)) return;

    try {
      const fs = await import('node:fs/promises');
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_INDEXABLE_BYTES) return;

      const content = await fs.readFile(filePath, 'utf-8');
      const safeContent = sanitizeSemanticContent(filePath, content);

      const { createHash } = await import('node:crypto');
      // Stamp the model into the checksum so switching models (e.g. MiniLM →
      // e5-base) invalidates every row and forces a re-index — content alone is
      // unchanged, so without this the stale-dimension vectors would linger.
      const checksum = createHash('md5')
        .update(SEMANTIC_MODEL_ID)
        .update(`\nretrieval-v${RETRIEVAL_INDEX_VERSION}\n`)
        .update(content)
        .digest('hex');
      const existing = this.db.prepare('SELECT checksum FROM semantic_embeddings WHERE workspace_id = ? AND file_path = ?').get(workspaceId, filePath) as any;

      const lexicalExisting = this.db.prepare('SELECT 1 AS present FROM semantic_documents WHERE workspace_id = ? AND file_path = ?').get(workspaceId, filePath) as { present?: number } | undefined;
      if (existing && existing.checksum === checksum && lexicalExisting?.present) return;

      // Backfill the lexical side after migration 043, or update it whenever
      // content changes. Unchanged launches avoid rewriting the FTS index.
      this.db.prepare(`
        INSERT INTO semantic_documents (workspace_id, file_path, content, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id, file_path) DO UPDATE SET
          content = excluded.content,
          updated_at = excluded.updated_at
      `).run(workspaceId, filePath, buildLexicalDocument(filePath, safeContent), Date.now());
      this.coverageCache.delete(workspaceId)

      if (existing && existing.checksum === checksum) return; // Skip if unchanged

      this.indexingCount.set(workspaceId, (this.indexingCount.get(workspaceId) ?? 0) + 1);
      try {
        // Embed each window (E5 "passage:" prefix) so a query can match logic
        // anywhere in the file, not just its header. Stored as number[][] (one
        // vector per chunk); query ranks by a file's best-matching chunk.
        const chunks = chunkSourceText(filePath, safeContent);
        const embeddings: number[][] = [];
        for (const chunk of chunks) {
          embeddings.push(await this.getEmbedding(PASSAGE_PREFIX + chunk.text));
        }
        if (embeddings.length === 0) return;

        // Binary Float32 storage (040): the query path reads embedding_blob and
        // scores via typed arrays — no JSON.parse. embedding_json kept as '' to
        // satisfy the legacy NOT NULL column; legacy rows still carry real JSON
        // and are read via the fallback path until they re-index.
        const { blob, dim } = encodeEmbeddings(embeddings);
        this.db.prepare(`
          INSERT INTO semantic_embeddings (workspace_id, file_path, checksum, embedding_json, embedding_blob, dim, chunk_metadata_json, updated_at)
          VALUES (?, ?, ?, '', ?, ?, ?, ?)
          ON CONFLICT(workspace_id, file_path) DO UPDATE SET
            checksum = excluded.checksum,
            embedding_json = '',
            embedding_blob = excluded.embedding_blob,
            dim = excluded.dim,
            chunk_metadata_json = excluded.chunk_metadata_json,
            updated_at = excluded.updated_at
        `).run(workspaceId, filePath, checksum, blob, dim, JSON.stringify(chunks.map(({ text: _text, ...metadata }) => metadata)), Date.now());
        this.log('debug', `Indexed ${path.basename(filePath)} (${embeddings.length} chunk${embeddings.length === 1 ? '' : 's'}).`, { workspaceId, file: filePath });
      } finally {
        this.indexingCount.set(workspaceId, Math.max(0, (this.indexingCount.get(workspaceId) ?? 1) - 1));
      }
    } catch (err) {
      // Binary files, unreadable files, or transient worker failures. Log at
      // debug so the panel can show why a file didn't index without alarming.
      this.log('debug', `Skipped ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`, { workspaceId, file: filePath });
    }
  }

  /** Backward-compatible file ranking used by older internal callers/tests. */
  public async query(workspaceId: string, text: string, limit = 5): Promise<{ filePath: string, score: number }[]> {
    const report = await this.queryDetailed(workspaceId, text, { limit })
    return report.results.map((result) => ({ filePath: result.filePath, score: result.semanticScore ?? result.score }))
  }

  /**
   * Adaptive local retrieval: vector meaning + FTS5 exact terms, fused through
   * reciprocal rank. Only final source windows are hydrated and a hard context
   * budget prevents retrieval from consuming the savings it is meant to create.
   */
  public async queryDetailed(workspaceId: string, text: string, options: SemanticQueryOptions = {}): Promise<SemanticQueryReport> {
    const startedAt = Date.now()
    const requestedMode = options.mode ?? this.getMode(workspaceId)
    let resolvedMode = resolveSemanticSearchMode(text, requestedMode)

    const rows = this.db.prepare('SELECT file_path, embedding_json, embedding_blob, dim, chunk_metadata_json FROM semantic_embeddings WHERE workspace_id = ?').all(workspaceId) as any[]

    const semanticCandidates: Array<{ filePath: string; score: number; bestChunkIndex?: number; bestChunkStart?: number; bestChunkEnd?: number; bestChunkLineStart?: number; bestChunkLineEnd?: number; bestChunkKind?: SemanticSourceChunk['kind']; bestChunkName?: string }> = []
    let semanticSearchCompleted = false
    try {
      const queryEmbedding = await this.getEmbedding(QUERY_PREFIX + text)
      const queryF32 = Float32Array.from(queryEmbedding)
      for (const row of rows) {
        try {
          if (row.embedding_blob && row.dim) {
            const detail = bestChunkScoreBlobWithIndex(queryF32, row.embedding_blob as Buffer, row.dim as number)
            if (detail) {
              const metadata = parseChunkMetadata(row.chunk_metadata_json, detail.chunkIndex)
              semanticCandidates.push({ filePath: row.file_path, score: detail.score, bestChunkIndex: detail.chunkIndex, ...metadata })
            }
          } else {
            const score = bestChunkScore(queryEmbedding, JSON.parse(row.embedding_json))
            if (score !== null) semanticCandidates.push({ filePath: row.file_path, score })
          }
        } catch {
          // Malformed or stale-dimension rows self-heal on edit/reindex.
        }
      }
      semanticSearchCompleted = true
    } catch (err) {
      this.log('warn', `Vector search unavailable; continuing with lexical retrieval: ${err instanceof Error ? err.message : String(err)}`, { workspaceId })
    }
    semanticCandidates.sort((a, b) => b.score - a.score)

    const ftsQuery = buildFtsQuery(text)
    const requestedLimit = Math.max(1, Math.min(50, Math.floor(options.limit ?? (resolvedMode === 'exhaustive' ? 20 : 5))))
    const exhaustivePoolLimit = Math.max(250, requestedLimit * 20)
    const explorePoolLimit = Math.max(40, requestedLimit * 8)
    const lexicalPoolLimit = resolvedMode === 'exhaustive' || requestedMode === 'auto' ? exhaustivePoolLimit : explorePoolLimit
    let lexicalTotal = 0
    let lexicalSearchCompleted = false
    let lexicalCandidates: Array<{ filePath: string; score: number; matchedTerms: string[] }> = []
    if (ftsQuery) {
      try {
        lexicalTotal = (this.db.prepare(`
          SELECT COUNT(*) AS n FROM semantic_documents_fts
          WHERE semantic_documents_fts MATCH ? AND workspace_id = ?
        `).get(ftsQuery, workspaceId) as { n?: number } | undefined)?.n ?? 0
        const lexicalRows = this.db.prepare(`
          SELECT file_path, bm25(semantic_documents_fts, 0.0, 0.2, 1.0) AS rank
          FROM semantic_documents_fts
          WHERE semantic_documents_fts MATCH ? AND workspace_id = ?
          ORDER BY rank ASC
          LIMIT ?
        `).all(ftsQuery, workspaceId, lexicalPoolLimit) as Array<{ file_path: string; rank: number }>
        const terms = tokenizeSemanticQuery(text)
        lexicalCandidates = lexicalRows.map((row) => ({
          filePath: row.file_path,
          score: Number.isFinite(row.rank) ? -row.rank : 0,
          matchedTerms: terms
        }))
        lexicalSearchCompleted = true
      } catch (err) {
        this.log('warn', `Lexical search unavailable: ${err instanceof Error ? err.message : String(err)}`, { workspaceId })
      }
    }

    let fused = fuseRetrievalCandidates(
      semanticCandidates.slice(0, resolvedMode === 'exhaustive' ? exhaustivePoolLimit : explorePoolLimit),
      lexicalCandidates.slice(0, resolvedMode === 'exhaustive' ? exhaustivePoolLimit : explorePoolLimit)
    )
    let confidence = semanticSearchCompleted ? estimateRetrievalConfidence(fused) : 'low'
    const expanded = shouldExpandAutomaticRetrieval(requestedMode, resolvedMode, confidence)
    const expansionReason = expanded ? 'The token-first pass had low confidence, so auto mode searched the broader candidate pool.' : null
    if (expanded) {
      resolvedMode = 'exhaustive'
      fused = fuseRetrievalCandidates(semanticCandidates.slice(0, exhaustivePoolLimit), lexicalCandidates.slice(0, exhaustivePoolLimit))
      confidence = semanticSearchCompleted ? estimateRetrievalConfidence(fused) : 'low'
    }
    // Auto expansion broadens candidate coverage, not the amount of source
    // injected into context. Keep the token-first output budget unless the
    // caller explicitly requested exhaustive mode or supplied a larger budget.
    const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? (expanded ? requestedLimit : resolvedMode === 'exhaustive' ? 20 : 5))))
    const maxTokens = Math.max(400, Math.min(20_000, Math.floor(options.maxTokens ?? (expanded ? 3_000 : resolvedMode === 'exhaustive' ? 8_000 : 3_000))))
    const results: SemanticQueryMatch[] = []
    let estimatedTokens = 0
    let estimatedFullFileTokens = 0
    for (const candidate of fused) {
      if (results.length >= limit) break
      const hydrated = await this.hydrateMatch(candidate, text)
      if (results.length > 0 && estimatedTokens + hydrated.estimatedTokens > maxTokens) break
      results.push(hydrated)
      estimatedTokens += hydrated.estimatedTokens
      estimatedFullFileTokens += hydrated.fullFileEstimatedTokens
    }

    const truncated = fused.length > results.length || lexicalTotal > lexicalCandidates.length
    const vectorWarning = semanticSearchCompleted ? '' : ' Vector embeddings were unavailable for this query.'
    const warning = resolvedMode === 'exhaustive'
      ? `${lexicalSearchCompleted ? 'Full local lexical index searched.' : 'Lexical index was unavailable; vector results are not exhaustive.'} Results can still omit generated/binary files, ignored directories, runtime dispatch and references unsupported by the structural parser.${truncated ? ' Output was capped by the result/context budget.' : ''}`
      : confidence === 'low' || truncated
        ? 'Ranked best-effort exploration; switch to exhaustive mode before refactors, renames, or completeness-sensitive changes.'
        : null
    const combinedWarning = warning ? `${warning}${vectorWarning}` : vectorWarning.trim() || null
    const durationMs = Date.now() - startedAt
    const estimatedSavingsPercent = estimatedFullFileTokens > 0
      ? Math.max(0, Math.round((1 - estimatedTokens / estimatedFullFileTokens) * 100))
      : 0
    const report: SemanticQueryReport = {
      query: text,
      requestedMode,
      resolvedMode,
      confidence,
      expanded,
      expansionReason,
      results,
      coverage: {
        indexedFiles: rows.length,
        semanticCandidates: semanticCandidates.length,
        lexicalCandidates: lexicalTotal,
        searchedFullLexicalIndex: lexicalSearchCompleted && resolvedMode === 'exhaustive',
        truncated,
        excluded: ['generated/binary files', 'ignored dependency/build directories', 'runtime-only dynamic dispatch']
      },
      estimatedTokens,
      estimatedFullFileTokens,
      estimatedSavingsPercent,
      durationMs,
      warning: combinedWarning
    }
    this.lastQueries.set(workspaceId, {
      requestedMode,
      resolvedMode,
      confidence,
      expanded,
      expansionReason,
      durationMs,
      semanticCandidates: semanticCandidates.length,
      lexicalCandidates: lexicalTotal,
      returnedResults: results.length,
      estimatedTokens,
      estimatedFullFileTokens,
      estimatedSavingsPercent,
      truncated
    })
    const querySnippet = text.length > 60 ? `${text.slice(0, 60)}…` : text
    this.log('info', `Hybrid ${resolvedMode} query${expanded ? ' (auto-expanded)' : ''} "${querySnippet}" → ${results.length} result(s), ${estimatedTokens} estimated tokens, ${confidence} confidence in ${durationMs}ms${truncated ? ' (capped)' : ''}.`, { workspaceId })
    return report
  }

  private async hydrateMatch(candidate: FusedRetrievalCandidate, query: string): Promise<SemanticQueryMatch> {
    try {
      const fs = await import('node:fs/promises')
      const content = sanitizeSemanticContent(candidate.filePath, await fs.readFile(candidate.filePath, 'utf-8'))
      const normalized = content.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      const queryTerms = tokenizeSemanticQuery(query)
      const matchedTerms = queryTerms.filter((term) => normalized.includes(term))
      let focus = candidate.bestChunkStart !== null
        ? candidate.bestChunkStart + Math.floor(((candidate.bestChunkEnd ?? candidate.bestChunkStart) - candidate.bestChunkStart) / 2)
        : -1
      const matchFrom = candidate.bestChunkStart ?? 0
      const matchTo = candidate.bestChunkEnd ?? normalized.length
      for (const term of matchedTerms) {
        const index = normalized.indexOf(term, matchFrom)
        if (index >= matchFrom && index < matchTo) { focus = index; break }
        if (focus < 0) {
          const globalIndex = normalized.indexOf(term)
          if (globalIndex >= 0) focus = globalIndex
        }
      }
      if (focus < 0 && candidate.bestChunkIndex !== null) {
        focus = candidate.bestChunkIndex * (CHUNK_CHARS - CHUNK_OVERLAP) + Math.floor(CHUNK_CHARS / 2)
      }
      if (focus < 0) focus = 0
      let start = Math.max(0, focus - 350)
      let end = Math.min(content.length, start + 1_400)
      const previousNewline = content.lastIndexOf('\n', start)
      if (previousNewline >= 0) start = previousNewline + 1
      const nextNewline = content.indexOf('\n', end)
      if (nextNewline >= 0) end = nextNewline
      const snippet = content.slice(start, end).trimEnd()
      const lineStart = content.slice(0, start).split('\n').length
      const lineEnd = lineStart + Math.max(0, snippet.split('\n').length - 1)
      const reasons = [...candidate.reasons.filter((reason) => !reason.startsWith('matched:'))]
      if (matchedTerms.length > 0) reasons.push(`matched: ${matchedTerms.join(', ')}`)
      const estimatedTokens = Math.ceil((candidate.filePath.length + snippet.length + reasons.join(' ').length) / 4)
      return { ...candidate, matchedTerms, reasons, snippet, lineStart, lineEnd, estimatedTokens, fullFileEstimatedTokens: Math.ceil(content.length / 4) }
    } catch {
      return {
        ...candidate,
        snippet: '',
        lineStart: 0,
        lineEnd: 0,
        estimatedTokens: Math.ceil(candidate.filePath.length / 4),
        fullFileEstimatedTokens: Math.ceil(candidate.filePath.length / 4)
      }
    }
  }

  public destroy() {
    this.destroyed = true;
    if (this.bootstrapTimer) { clearTimeout(this.bootstrapTimer); this.bootstrapTimer = null; }
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.rejectAllPending(new Error('Semantic service destroyed'));

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
