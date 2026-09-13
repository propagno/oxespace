import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppDatabase } from '../../db'
import type { DocumentationArtifact, DocumentationJob, DocumentationOperation, DocumentationStep } from '../../../../shared/types/documentation'

export interface CapturedPage { png: Buffer; pageUrl: string; width: number; height: number; redactionCount: number }
const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
export function boundedText(value: unknown, name: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`Invalid ${name}`)
  return value.trim()
}
const html = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const markdown = (s: string): string => s.replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, '\\$1')

/** Project-owned manual checkpoints. No dependency on AI Memory or native session IDs. */
export class DocumentationService {
  private busy = new Set<string>()
  constructor(private db: AppDatabase, private directory: string) {
    for (const row of db.prepare('SELECT id,payload FROM documentation_operations').all() as {id: string; payload: string}[]) {
      const op = JSON.parse(row.payload) as DocumentationOperation
      if (op.state === 'running') { op.state = 'interrupted'; op.error = 'Application stopped. Retry the same request key; no browser actions are replayed.'; this.saveOperation(op) }
    }
  }
  list(project: string): DocumentationJob[] {
    return (this.db.prepare('SELECT payload FROM documentation_jobs WHERE project=? ORDER BY rowid DESC LIMIT 100').all(project) as {payload:string}[]).map(row => JSON.parse(row.payload))
  }
  get(project: string, id: string): DocumentationJob {
    const row = this.db.prepare('SELECT payload FROM documentation_jobs WHERE project=? AND id=?').get(project, id) as {payload:string}|undefined
    if (!row) throw new Error('Documentation job not found in this project')
    return JSON.parse(row.payload)
  }
  create(project: string, title: unknown, key: unknown): DocumentationJob {
    const name = boundedText(title, 'title', 200), requestKey = boundedText(key, 'key', 100)
    // Deterministic identity makes a timed-out create recoverable across native executions.
    const id = digest(`${project}\0${requestKey}`).slice(0, 32)
    const oldRow = this.db.prepare('SELECT payload FROM documentation_jobs WHERE project=? AND id=?').get(project, id) as {payload:string}|undefined
    const old = oldRow ? JSON.parse(oldRow.payload) as DocumentationJob : undefined
    if (old) { if (old.title !== name) throw new Error('Request key conflict'); return old }
    const job: DocumentationJob = { id, project, title: name, revision: 0, createdAt: Date.now(), updatedAt: Date.now(), steps: [], artifacts: [], notes: '' }
    this.db.prepare('INSERT INTO documentation_jobs(id,project,payload) VALUES(?,?,?)').run(id, project, JSON.stringify(job))
    return job
  }
  checkpoint(project: string, id: string, revision: number, steps: DocumentationStep[], notes: unknown = ''): DocumentationJob {
    const job = this.get(project, id)
    this.checkRevision(job, revision)
    if (this.busy.has(id)) throw new Error('Operation in progress; inspect the job before changing it')
    if (!Array.isArray(steps) || steps.length > 100 || typeof notes !== 'string' || notes.length > 16000) throw new Error('Invalid checkpoint')
    const seen = new Set<string>()
    job.steps = steps.map(step => {
      const stepId = boundedText(step.id, 'step id', 80)
      if (seen.has(stepId)) throw new Error('Duplicate step id')
      seen.add(stepId)
      if (!['pending', 'captured', 'verified'].includes(step.state)) throw new Error('Invalid step state')
      const artifact = step.artifactId ? job.artifacts.find(a => a.id === step.artifactId && a.stepId === stepId) : undefined
      if (step.state !== 'pending' && !artifact) throw new Error('Captured/verified steps require their own screenshot')
      if (step.state === 'verified') boundedText(step.evidence, 'verification evidence')
      return { id: stepId, title: boundedText(step.title, 'step title', 200), instruction: boundedText(step.instruction, 'instruction', 6000), state: step.state,
        ...(artifact ? { artifactId: artifact.id } : {}), ...(step.evidence ? { evidence: boundedText(step.evidence, 'evidence') } : {}) }
    })
    job.notes = notes; this.save(job)
    return job
  }
  operations(project: string, id: string): DocumentationOperation[] {
    this.get(project, id)
    return (this.db.prepare('SELECT payload FROM documentation_operations WHERE job_id=? ORDER BY rowid DESC LIMIT 100').all(id) as {payload:string}[]).map(row => JSON.parse(row.payload))
  }
  private save(job: DocumentationJob): void {
    job.revision++; job.updatedAt = Date.now()
    this.db.transaction(() => {
      this.db.prepare('UPDATE documentation_jobs SET payload=? WHERE id=?').run(JSON.stringify(job), job.id)
      this.db.prepare('INSERT INTO documentation_checkpoints(job_id,revision,payload) VALUES(?,?,?)').run(job.id, job.revision, JSON.stringify(job))
    })()
  }
  private checkRevision(job: DocumentationJob, revision: number): void {
    if (!Number.isSafeInteger(revision) || job.revision !== revision) throw new Error(`Revision conflict. Reload job; current revision is ${job.revision}`)
  }
  private saveOperation(op: DocumentationOperation): void {
    op.updatedAt = Date.now()
    this.db.prepare('UPDATE documentation_operations SET payload=? WHERE id=?').run(JSON.stringify(op), op.id)
  }
  private async operation(project: string, jobId: string, key: string, kind: DocumentationOperation['kind'], input: unknown, run: (op: DocumentationOperation) => Promise<unknown>): Promise<DocumentationOperation> {
    this.get(project, jobId); boundedText(key, 'key', 100)
    const hash = digest(JSON.stringify({ kind, input }))
    const row = this.db.prepare('SELECT payload,input_hash FROM documentation_operations WHERE job_id=? AND request_key=?').get(jobId, key) as {payload:string;input_hash:string}|undefined
    let op: DocumentationOperation
    if (row) {
      if (row.input_hash !== hash) throw new Error('Request key conflict')
      op = JSON.parse(row.payload)
      if (op.state === 'succeeded' || op.state === 'running') return op
    } else {
      op = { id: randomUUID(), requestKey: key, jobId, kind, state: 'running', createdAt: Date.now(), updatedAt: Date.now() }
    }
    if (this.busy.has(jobId)) throw new Error('Another documentation operation is running')
    this.busy.add(jobId)
    op.state = 'running'; delete op.error
    this.db.prepare('INSERT INTO documentation_operations(id,job_id,request_key,input_hash,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload')
      .run(op.id, jobId, key, hash, JSON.stringify(op))
    try { op.result = await run(op); op.state = 'succeeded' }
    catch { op.state = 'failed'; op.error = 'Operation failed. Verify preview readiness, permission, job revision and local storage, then retry.' }
    finally { try { this.saveOperation(op) } finally { this.busy.delete(jobId) } }
    return op
  }
  async capture(project: string, id: string, revision: number, stepId: string, key: string, options: unknown, capture: () => Promise<CapturedPage>): Promise<DocumentationOperation> {
    return this.operation(project, id, key, 'capture', { stepId, options }, async op => {
      const job = this.get(project, id); this.checkRevision(job, revision)
      if (job.artifacts.length >= 200) throw new Error('Artifact limit reached; start another manual')
      const step = job.steps.find(s => s.id === stepId)
      if (!step) throw new Error('Step not found')
      const shot = await capture()
      if (shot.png.length > 20 * 1024 * 1024 || shot.png.length < 8) throw new Error('Screenshot outside size limit')
      const filename = `${op.id}.png`
      await mkdir(join(this.directory, job.id), { recursive: true })
      const path = join(this.directory, job.id, filename)
      await writeFile(`${path}.tmp`, shot.png, { mode: 0o600 }); await rename(`${path}.tmp`, path)
      const artifact: DocumentationArtifact = { id: op.id, stepId, filename, sha256: digest(shot.png), capturedAt: Date.now(), pageUrl: shot.pageUrl,
        width: shot.width, height: shot.height, redactionCount: shot.redactionCount }
      job.artifacts = [...job.artifacts.filter(a => a.id !== op.id), artifact]
      step.artifactId = artifact.id; step.state = 'captured'; delete step.evidence
      // Commit the artifact reference and success receipt together. A crash must
      // not leave a committed screenshot looking like a retryable operation.
      this.db.transaction(() => {
        this.save(job)
        op.result = { artifact, revision: job.revision }
        op.state = 'succeeded'
        this.saveOperation(op)
      })()
      return op.result
    })
  }
  async export(project: string, id: string, revision: number, key: string): Promise<DocumentationOperation> {
    return this.operation(project, id, key, 'export', { revision }, async op => {
      const job = this.get(project, id); this.checkRevision(job, revision)
      const warnings: string[] = []
      const blocks: string[] = [], md = [`# ${markdown(job.title)}`, '', `Revision: ${job.revision}`, '']
      let imageBytes = 0
      for (const [index, step] of job.steps.entries()) {
        const a = job.artifacts.find(a => a.id === step.artifactId)
        let data: Buffer | undefined
        if (a) {
          data = await readFile(join(this.directory, job.id, a.filename))
          imageBytes += data.length
          if (imageBytes > 64 * 1024 * 1024) throw new Error('Export exceeds image budget; split the manual into chapters')
          if (digest(data) !== a.sha256) throw new Error('Screenshot integrity check failed')
        }
        if (step.state !== 'verified') warnings.push(`Step ${index + 1} needs review`)
        if (!a) warnings.push(`Step ${index + 1} has no screenshot`)
        md.push(`## ${index + 1}. ${markdown(step.title)}`, '', markdown(step.instruction), '', ...(a ? [`![Step ${index + 1}](${a.filename})`, '', `Captured: ${new Date(a.capturedAt).toISOString()} — ${markdown(a.pageUrl)}`, ''] : []))
        blocks.push(`<section><h2>${index + 1}. ${html(step.title)}</h2><p>${html(step.instruction)}</p>${data ? `<img alt="Step ${index + 1}" src="data:image/png;base64,${data.toString('base64')}">` : '<p>No screenshot</p>'}<small>${html(step.evidence ?? 'Not verified')}</small></section>`)
      }
      if (!job.steps.length) warnings.push('Manual has no steps')
      const base = join(this.directory, job.id, `manual-${revision}-${op.id}`)
      await mkdir(join(this.directory, job.id), { recursive: true })
      const document = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${html(job.title)}</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:24px;color:#18212b}p{white-space:pre-wrap;line-height:1.7}img{max-width:100%;border:1px solid #ddd}section{break-inside:avoid;margin:40px 0}small{color:#555}</style></head><body><h1>${html(job.title)}</h1><p>Revision ${revision}. ${html(warnings.join('. '))}</p>${blocks.join('')}</body></html>`
      await writeFile(`${base}.md`, md.join('\n'), { mode: 0o600 })
      await writeFile(`${base}.html`, document, { mode: 0o600 })
      await writeFile(`${base}.json`, JSON.stringify(job, null, 2), { mode: 0o600 })
      return { markdown: `${base}.md`, html: `${base}.html`, manifest: `${base}.json`, warnings, reviewRequired: warnings.length > 0 }
    })
  }
  history(project: string, id: string): { revision: number; updatedAt: number }[] {
    this.get(project, id)
    return (this.db.prepare('SELECT revision,payload FROM documentation_checkpoints WHERE job_id=? ORDER BY revision DESC LIMIT 100').all(id) as {revision:number;payload:string}[])
      .map(row => ({ revision: row.revision, updatedAt: (JSON.parse(row.payload) as DocumentationJob).updatedAt }))
  }
  async image(project: string, id: string, artifactId: string): Promise<Buffer> {
    const job = this.get(project, id), artifact = job.artifacts.find(a => a.id === artifactId)
    if (!artifact) throw new Error('Artifact not found')
    const data = await readFile(join(this.directory, id, artifact.filename))
    if (digest(data) !== artifact.sha256) throw new Error('Artifact integrity check failed')
    return data
  }
}
