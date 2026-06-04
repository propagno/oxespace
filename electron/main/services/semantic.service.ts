import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type { AppDatabase } from '../db'
import chokidar, { FSWatcher } from 'chokidar'
import { makeIgnoreFilter } from './semantic-ignore'
import { bestChunkScore, chunkText } from './semantic-chunk'

export interface SemanticStatus {
  enabled: boolean
  workerReady: boolean
  indexing: boolean
  count: number
  lastError: string | null
}

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
  private workerReady = false;
  private lastError: string | null = null;
  /** Callers blocked in getEmbedding waiting for the model to finish loading. */
  private readyWaiters: { resolve: () => void; reject: (err: Error) => void }[] = [];

  constructor(private readonly db: AppDatabase) {
    this.initWorker();
    // Start indexing the already-active workspace on boot. The renderer only
    // calls workspace.setActive when the user *switches* workspaces, so without
    // this the active workspace on launch would never get watched and the index
    // would stay empty.
    this.bootstrapActiveWorkspace();
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
      // In production, the worker script is at app.getAppPath()/out/main/semantic-worker.js
      // In development, it's relative to __dirname (which is out/main)
      const workerPath = app.isPackaged
        ? path.join(app.getAppPath(), 'out', 'main', 'semantic-worker.js')
        : path.join(__dirname, 'semantic-worker.js');

      // The transformers.js model cache must live somewhere writable. Inside a
      // packaged build node_modules sits in a read-only asar, so point the cache
      // at userData and pass it to the worker (a plain Node thread with no access
      // to electron's `app`).
      const cacheDir = path.join(app.getPath('userData'), 'models');
      try { mkdirSync(cacheDir, { recursive: true }); } catch { /* best effort */ }

      this.worker = new Worker(workerPath, { workerData: { cacheDir } });

      this.worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          this.workerReady = true;
          this.lastError = null;
          this.flushReadyWaiters();
          // eslint-disable-next-line no-console
          console.log('[SemanticService] Worker initialized and ready.');
        } else if (msg.type === 'result' || msg.type === 'error') {
          if (msg.type === 'error' && !msg.id) {
            // An init-time error (e.g. model failed to load) carries no request id.
            this.lastError = msg.error;
            this.workerReady = false;
            this.rejectReadyWaiters(new Error(msg.error));
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
        // eslint-disable-next-line no-console
        console.error('[SemanticService] Worker error:', err);
      });

      this.worker.on('exit', (code) => {
        this.workerReady = false;
        const error = new Error(`Semantic worker exited (code ${code})`);
        this.rejectAllPending(error);
        this.rejectReadyWaiters(error);
        // eslint-disable-next-line no-console
        console.log(`[SemanticService] Worker stopped with exit code ${code}`);
      });

      // Send init command
      this.worker.postMessage({ type: 'init' });

    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[SemanticService] Failed to initialize worker', err);
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
   * emit `add` events before the ~30MB MiniLM model finishes loading; without
   * this gate those embeds would fail with "Model not initialized" and the
   * files would silently never be indexed.
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

  /** True unless the workspace was explicitly disabled (default-on). */
  public isEnabled(workspaceId: string): boolean {
    return this.enabled.get(workspaceId) ?? true;
  }

  /**
   * Toggle the feature for a workspace. Disabling stops indexing immediately;
   * enabling resumes watching the recorded root. Driven from the renderer so the
   * main-process indexing/tool respect the user's per-workspace preference.
   */
  public setEnabled(workspaceId: string, enabled: boolean, rootPath?: string) {
    this.enabled.set(workspaceId, enabled);
    if (rootPath) this.roots.set(workspaceId, rootPath);
    if (enabled) {
      // The renderer toggle calls this without a rootPath, so fall back to the
      // workspace's recorded root (resolved from the DB if not already cached).
      const root = this.resolveRoot(workspaceId);
      if (root) this.startWatching(workspaceId, root);
    } else {
      this.stopWatching(workspaceId);
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

    const watcher = chokidar.watch(rootPath, {
      // Ignore heavy/irrelevant directories and dotfiles. Per-file extension
      // filtering happens in queueFileForEmbedding so directories aren't dropped
      // by an extension test.
      ignored: makeIgnoreFilter(rootPath),
      persistent: true,
      ignoreInitial: false
    });

    watcher.on('add', (filePath) => this.queueFileForEmbedding(workspaceId, filePath));
    watcher.on('change', (filePath) => this.queueFileForEmbedding(workspaceId, filePath));
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
      const checksum = createHash('md5').update(content).digest('hex');
      const existing = this.db.prepare('SELECT checksum FROM semantic_embeddings WHERE workspace_id = ? AND file_path = ?').get(workspaceId, filePath) as any;

      if (existing && existing.checksum === checksum) return; // Skip if unchanged

      this.indexingCount.set(workspaceId, (this.indexingCount.get(workspaceId) ?? 0) + 1);
      try {
        // Embed each ~256-token window so a query can match logic anywhere in
        // the file, not just its header. Stored as number[][] (one vector per
        // chunk); query ranks by a file's best-matching chunk.
        const chunks = chunkText(content);
        const embeddings: number[][] = [];
        for (const chunk of chunks) {
          embeddings.push(await this.getEmbedding(chunk));
        }
        if (embeddings.length === 0) return;

        this.db.prepare(`
          INSERT INTO semantic_embeddings (workspace_id, file_path, checksum, embedding_json, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id, file_path) DO UPDATE SET
            checksum = excluded.checksum,
            embedding_json = excluded.embedding_json,
            updated_at = excluded.updated_at
        `).run(workspaceId, filePath, checksum, JSON.stringify(embeddings), Date.now());
      } finally {
        this.indexingCount.set(workspaceId, Math.max(0, (this.indexingCount.get(workspaceId) ?? 1) - 1));
      }
    } catch {
      // Ignore binary files, unreadable files, or transient worker failures.
    }
  }

  public async query(workspaceId: string, text: string, limit = 5): Promise<{ filePath: string, score: number }[]> {
    const queryEmbedding = await this.getEmbedding(text);

    const rows = this.db.prepare('SELECT file_path, embedding_json FROM semantic_embeddings WHERE workspace_id = ?').all(workspaceId) as any[];

    const results: { filePath: string, score: number }[] = [];
    for (const row of rows) {
      try {
        const score = bestChunkScore(queryEmbedding, JSON.parse(row.embedding_json));
        if (score !== null) results.push({ filePath: row.file_path, score });
      } catch {
        // Skip rows with malformed or dimension-mismatched embeddings.
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  public destroy() {
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.rejectAllPending(new Error('Semantic service destroyed'));

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
