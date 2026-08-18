import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type { FileSystemService } from './file-system.service'

const execFileAsync = promisify(execFile)
const MAX_FILE_BYTES = 512 * 1024
const MAX_SYMBOLS = 24

export type QualitySeverity = 'info' | 'warning' | 'high'
export type QualityVerdict = 'pass' | 'warn' | 'fail'

export interface QualityFinding {
  severity: QualitySeverity
  code: string
  message: string
  files: string[]
  recommendation: string
}

export interface QualityCheckReport {
  verdict: QualityVerdict
  summary: string
  changedFiles: string[]
  impactedFiles: string[]
  findings: QualityFinding[]
  evidence: {
    testsChanged: string[]
    contractsChanged: string[]
    migrationsChanged: string[]
    symbolsScanned: string[]
    acceptanceCriteria: Array<{ criterion: string; status: 'evidenced' | 'missing'; files: string[] }>
  }
  limitations: string[]
  durationMs: number
}

export interface QualitySnapshot {
  changedFiles: string[]
  contents: Map<string, string>
  references: Map<string, string[]>
  acceptanceCriteria?: string[]
  maxFindings?: number
}

export class QualityControllerService {
  public async check(
    workspaceId: string,
    rootPath: string,
    fileSystem: FileSystemService,
    options: { baseRef?: string; acceptanceCriteria?: string[]; maxFindings?: number } = {}
  ): Promise<QualityCheckReport> {
    const startedAt = Date.now()
    const root = path.resolve(rootPath)
    const changedFiles = await collectChangedFiles(root, options.baseRef)
    const contents = new Map<string, string>()
    for (const file of changedFiles) {
      const content = await readTextFile(fileSystem, workspaceId, root, file)
      if (content !== null) contents.set(file, content)
    }

    const symbols = extractChangedSymbols(contents)
    const references = await collectExactReferences(fileSystem, workspaceId, root, symbols, new Set(changedFiles))
    const report = analyzeQualitySnapshot({
      changedFiles,
      contents,
      references,
      acceptanceCriteria: options.acceptanceCriteria,
      maxFindings: options.maxFindings
    })
    return { ...report, durationMs: Date.now() - startedAt }
  }
}

export function analyzeQualitySnapshot(snapshot: QualitySnapshot): QualityCheckReport {
  const changed = [...new Set(snapshot.changedFiles.map(normalizePath))].sort()
  const changedSet = new Set(changed)
  const testsChanged = changed.filter(isTestFile)
  const contractsChanged = changed.filter(isContractFile)
  const migrationsChanged = changed.filter(isMigrationFile)
  const sourceChanged = changed.filter((file) => isSourceFile(file) && !isTestFile(file))
  const symbols = [...snapshot.references.keys()]
  const impactedFiles = [...new Set([...snapshot.references.values()].flat().map(normalizePath))]
    .filter((file) => !changedSet.has(file))
    .sort()
  const findings: QualityFinding[] = []

  if (sourceChanged.length > 0 && testsChanged.length === 0) {
    findings.push({
      severity: 'warning', code: 'SOURCE_WITHOUT_TEST',
      message: `${sourceChanged.length} source file(s) changed without a test file in the diff.`,
      files: sourceChanged.slice(0, 12),
      recommendation: 'Add or update focused tests, or record why existing coverage is sufficient.'
    })
  }
  if (contractsChanged.length > 0 && impactedFiles.length > 0) {
    findings.push({
      severity: 'high', code: 'CONTRACT_CONSUMERS_UNCHANGED',
      message: `Changed contracts have ${impactedFiles.length} exact-reference consumer(s) outside the diff.`,
      files: [...contractsChanged, ...impactedFiles].slice(0, 16),
      recommendation: 'Review each consumer and update it or provide verification evidence that compatibility is preserved.'
    })
  }
  if (migrationsChanged.length > 0 && !testsChanged.some((file) => /migration|database|\bdb\b/i.test(file))) {
    findings.push({
      severity: 'high', code: 'MIGRATION_WITHOUT_TEST',
      message: 'A database migration changed without a migration/database test in the diff.',
      files: migrationsChanged,
      recommendation: 'Test both a clean database and upgrade/idempotency from the previous schema version.'
    })
  }
  if (impactedFiles.length >= 12) {
    findings.push({
      severity: 'warning', code: 'HIGH_BLAST_RADIUS',
      message: `${impactedFiles.length} unchanged files reference symbols modified by this diff.`,
      files: impactedFiles.slice(0, 16),
      recommendation: 'Use exhaustive retrieval and run the broadest relevant typecheck/test suite before completion.'
    })
  }

  const acceptanceCriteria = (snapshot.acceptanceCriteria ?? [])
    .map((criterion) => criterion.trim()).filter(Boolean)
    .map((criterion) => {
      const terms = significantTerms(criterion)
      const files = changed.filter((file) => {
        const haystack = `${file}\n${snapshot.contents.get(file) ?? ''}`.toLowerCase()
        return terms.length > 0 && terms.some((term) => haystack.includes(term))
      })
      return { criterion, status: files.length > 0 ? 'evidenced' as const : 'missing' as const, files }
    })
  for (const item of acceptanceCriteria.filter((criterion) => criterion.status === 'missing')) {
    findings.push({
      severity: 'warning', code: 'ACCEPTANCE_EVIDENCE_MISSING',
      message: `No textual evidence in the diff was found for acceptance criterion: ${item.criterion}`,
      files: [],
      recommendation: 'Link the criterion to a changed implementation/test file or verify it explicitly and report the evidence.'
    })
  }
  if (changed.length === 0) {
    findings.push({
      severity: 'info', code: 'EMPTY_DIFF', message: 'No tracked or untracked changes were found.', files: [],
      recommendation: 'Run this check after implementation changes exist.'
    })
  }

  const maxFindings = Math.max(1, Math.min(100, Math.floor(snapshot.maxFindings ?? 30)))
  const limited = findings.slice(0, maxFindings)
  const verdict: QualityVerdict = limited.some((finding) => finding.severity === 'high')
    ? 'fail'
    : limited.some((finding) => finding.severity === 'warning') ? 'warn' : 'pass'
  return {
    verdict,
    summary: `${changed.length} changed file(s), ${impactedFiles.length} unchanged exact-reference consumer(s), ${limited.length} finding(s).`,
    changedFiles: changed,
    impactedFiles,
    findings: limited,
    evidence: { testsChanged, contractsChanged, migrationsChanged, symbolsScanned: symbols, acceptanceCriteria },
    limitations: [
      'Heuristic evidence does not prove runtime correctness; execute the project verification commands.',
      'Dynamic dispatch, generated files, reflection and references outside the Git worktree may be missed.'
    ],
    durationMs: 0
  }
}

async function collectChangedFiles(root: string, baseRef?: string): Promise<string[]> {
  if (baseRef && (!/^[A-Za-z0-9_./~^{}@:+-]+$/.test(baseRef) || baseRef.startsWith('-'))) {
    throw new Error('baseRef contains unsupported characters')
  }
  const commands: string[][] = baseRef
    ? [['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`, '--'], ['diff', '--name-only', '--diff-filter=ACMR', '--'], ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--'], ['ls-files', '--others', '--exclude-standard']]
    : [['diff', '--name-only', '--diff-filter=ACMR', '--'], ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '--'], ['ls-files', '--others', '--exclude-standard']]
  const files = new Set<string>()
  for (const args of commands) {
    const { stdout } = await execFileAsync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    for (const file of stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) files.add(normalizePath(file))
  }
  return [...files].sort()
}

async function collectExactReferences(fileSystem: FileSystemService, workspaceId: string, root: string, symbols: string[], changed: Set<string>): Promise<Map<string, string[]>> {
  const references = new Map<string, string[]>()
  if (symbols.length === 0) return references
  const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  const tracked = stdout.split(/\r?\n/).map(normalizePath).filter(Boolean).slice(0, 10_000)
  for (const symbol of symbols) references.set(symbol, [])
  for (const file of tracked) {
    if (changed.has(file) || !isSearchableText(file)) continue
    const content = await readTextFile(fileSystem, workspaceId, root, file)
    if (content === null) continue
    for (const symbol of symbols) {
      if (new RegExp(`\\b${escapeRegExp(symbol)}\\b`).test(content)) references.get(symbol)?.push(file)
    }
  }
  return references
}

async function readTextFile(fileSystem: FileSystemService, workspaceId: string, root: string, relativeFile: string): Promise<string | null> {
  try {
    const result = await fileSystem.readFile({ workspaceId, rootPath: root, relativePath: relativeFile })
    if (result.size > MAX_FILE_BYTES) return null
    return result.content
  } catch { return null }
}

function extractChangedSymbols(contents: Map<string, string>): string[] {
  const symbols = new Set<string>()
  const pattern = /\b(?:export\s+(?:default\s+)?)?(?:class|interface|type|enum|function|const|let|var|def|func|fun|fn|struct|trait)\s+([A-Za-z_$][\w$]{2,})/g
  for (const content of contents.values()) {
    for (const match of content.matchAll(pattern)) {
      symbols.add(match[1])
      if (symbols.size >= MAX_SYMBOLS) return [...symbols]
    }
  }
  return [...symbols]
}

function significantTerms(value: string): string[] {
  const stop = new Set(['para', 'com', 'sem', 'uma', 'que', 'the', 'and', 'with', 'from', 'when', 'should'])
  return [...new Set(value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9_]{4,}/g) ?? [])]
    .filter((term) => !stop.has(term)).slice(0, 10)
}

function normalizePath(value: string): string { return value.replace(/\\/g, '/') }
function isTestFile(file: string): boolean { return /(^|\/)(tests?|__tests__|specs?|e2e)(\/|$)|\.(test|spec)\.[^.]+$/i.test(file) }
function isMigrationFile(file: string): boolean { return /(^|\/)migrations?\//i.test(file) || /migration/i.test(path.basename(file)) }
function isContractFile(file: string): boolean { return /(^|\/)(shared|types?|schemas?|contracts?|api)(\/|$)|\.d\.ts$|ipc\.ts$/i.test(file) }
function isSourceFile(file: string): boolean { return /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|cs|php|swift|scala|c|cc|cpp|h|hpp|vue|svelte)$/i.test(file) }
function isSearchableText(file: string): boolean { return /\.(?:[cm]?[jt]sx?|jsonc?|mdx?|txt|ya?ml|toml|ini|py|rb|go|rs|java|kt|cs|php|swift|scala|c|cc|cpp|h|hpp|sql|css|scss|html|vue|svelte)$/i.test(file) }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
