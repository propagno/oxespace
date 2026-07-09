import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type { AppDatabase } from '../db'
import chokidar, { FSWatcher } from 'chokidar'
import { makeIgnoreFilter } from './semantic-ignore'
import { bestChunkScore, bestChunkScoreBlob, chunkText, encodeEmbeddings } from './semantic-chunk'
import { PASSAGE_PREFIX, QUERY_PREFIX, SEMANTIC_MODEL_ID } from './semantic-model'
import type { SemanticLogEntry, SemanticLogLevel } from '../../../shared/types/ipc'

export interface SemanticStatus {
  enabled: boolean
  workerReady: boolean
  indexing: boolean
  count: number
  lastError: string | null
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
const MAX_INDEXABLE_BYTES = 256 * 1024
const EMBED_TIMEOUT_MS = 30_000
/** Delay before the boot-time crawl of the active workspace, so the initial
 *  chokidar scan doesn't compete with first paint / terminal startup. */
const BOOTSTRAP_WATCH_DELAY_MS = 4_000

export class SemanticService {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void, timer: NodeJS.Timeout }>();
  private watchers = new Map<string, FSWatcher>();
  /** Recorded workspace roots so a toggle can (re)start watching on demand. */
  private roots = new Map<string, string>();
  /** Per-workspace enabled flag. Absent = enabled (default-on). */
  private enabled = new Map<string, boolean>();
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
    this.indexingCount.delete(workspaceId);
  }

  public getStatus(workspaceId: string): SemanticStatus {
    let count = 0;
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM semantic_embeddings WHERE workspace_id = ?').get(workspaceId) as { n: number } | undefined;
      count = row?.n ?? 0;
    } catch { /* table may not exist yet */ }
    return {
      enabled: this.isEnabled(workspaceId),
      workerReady: this.workerReady,
      indexing: (this.indexingCount.get(workspaceId) ?? 0) > 0,
      count,
      lastError: this.lastError
    };
  }

  /** Append a file to the serialized index chain (one file embedded at a time). */
  private enqueueIndex(workspaceId: string, filePath: string): void {
    this.indexChain = this.indexChain.then(() => this.queueFileForEmbedding(workspaceId, filePath));
  }

  private async queueFileForEmbedding(workspaceId: string, filePath: string) {
    // Skip files we don't want to embed before doing any work.
    if (!CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return;
    if (!this.isEnabled(workspaceId)) return;

    try {
      const fs = await import('node:fs/promises');
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_INDEXABLE_BYTES) return;

      const content = await fs.readFile(filePath, 'utf-8');

      const { createHash } = await import('node:crypto');
      // Stamp the model into the checksum so switching models (e.g. MiniLM →
      // e5-base) invalidates every row and forces a re-index — content alone is
      // unchanged, so without this the stale-dimension vectors would linger.
      const checksum = createHash('md5').update(SEMANTIC_MODEL_ID).update('\n').update(content).digest('hex');
      const existing = this.db.prepare('SELECT checksum FROM semantic_embeddings WHERE workspace_id = ? AND file_path = ?').get(workspaceId, filePath) as any;

      if (existing && existing.checksum === checksum) return; // Skip if unchanged

      this.indexingCount.set(workspaceId, (this.indexingCount.get(workspaceId) ?? 0) + 1);
      try {
        // Embed each window (E5 "passage:" prefix) so a query can match logic
        // anywhere in the file, not just its header. Stored as number[][] (one
        // vector per chunk); query ranks by a file's best-matching chunk.
        const chunks = chunkText(content);
        const embeddings: number[][] = [];
        for (const chunk of chunks) {
          embeddings.push(await this.getEmbedding(PASSAGE_PREFIX + chunk));
        }
        if (embeddings.length === 0) return;

        // Binary Float32 storage (040): the query path reads embedding_blob and
        // scores via typed arrays — no JSON.parse. embedding_json kept as '' to
        // satisfy the legacy NOT NULL column; legacy rows still carry real JSON
        // and are read via the fallback path until they re-index.
        const { blob, dim } = encodeEmbeddings(embeddings);
        this.db.prepare(`
          INSERT INTO semantic_embeddings (workspace_id, file_path, checksum, embedding_json, embedding_blob, dim, updated_at)
          VALUES (?, ?, ?, '', ?, ?, ?)
          ON CONFLICT(workspace_id, file_path) DO UPDATE SET
            checksum = excluded.checksum,
            embedding_json = '',
            embedding_blob = excluded.embedding_blob,
            dim = excluded.dim,
            updated_at = excluded.updated_at
        `).run(workspaceId, filePath, checksum, blob, dim, Date.now());
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

  public async query(workspaceId: string, text: string, limit = 5): Promise<{ filePath: string, score: number }[]> {
    const startedAt = Date.now();
    // E5 "query:" prefix — must mirror the "passage:" prefix used at index time.
    const queryEmbedding = await this.getEmbedding(QUERY_PREFIX + text);
    const queryF32 = Float32Array.from(queryEmbedding);

    const rows = this.db.prepare('SELECT file_path, embedding_json, embedding_blob, dim FROM semantic_embeddings WHERE workspace_id = ?').all(workspaceId) as any[];

    const results: { filePath: string, score: number }[] = [];
    for (const row of rows) {
      try {
        // Fast path: binary blob (no JSON.parse). Fallback: legacy JSON rows.
        const score = row.embedding_blob && row.dim
          ? bestChunkScoreBlob(queryF32, row.embedding_blob as Buffer, row.dim as number)
          : bestChunkScore(queryEmbedding, JSON.parse(row.embedding_json));
        if (score !== null) results.push({ filePath: row.file_path, score });
      } catch {
        // Skip rows with malformed or dimension-mismatched embeddings.
      }
    }

    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, limit);
    const snippet = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    this.log('info', `Query "${snippet}" → ${top.length}/${rows.length} matches in ${Date.now() - startedAt}ms${top[0] ? ` (top ${path.basename(top[0].filePath)} ${top[0].score.toFixed(3)})` : ''}.`, { workspaceId });
    return top;
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
