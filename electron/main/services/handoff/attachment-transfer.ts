import { copyFile, mkdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { mainMessage } from '../../../../shared/messages'
import type { ApprovalRequester } from '../../../../shared/types/approvals'
import type {
  HandoffAttachmentEndpoint,
  HandoffAttachmentTransferResult,
  HandoffTransferredFile
} from '../../../../shared/types/handoff-notice'
import { safeJoin } from '../../utils/safe-join'
import { ActionRefused } from '../agent-actions/agent-actions'
import type { ApprovalCenter } from '../approvals/approval-center'
import { brokerDraft } from '../approvals/drafts'

export const MAX_ATTACHMENT_FILES = 25
export const MAX_ATTACHMENT_FILE_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024

export interface AttachmentTransferInput {
  origin: HandoffAttachmentEndpoint
  destination: HandoffAttachmentEndpoint
  files: string[]
  targetDir?: string
}

export interface ValidatedAttachmentFile {
  relativePath: string
  sourcePath: string
  canonicalSourcePath: string
  size: number
}

export interface ValidatedAttachmentPlan {
  origin: { sessionId: string; provider: string; rootPath: string; canonicalRoot: string; label: string }
  destination: { sessionId: string; provider: string; rootPath: string; canonicalRoot: string; label: string }
  destinationDir: string
  files: ValidatedAttachmentFile[]
  totalBytes: number
  approvalTarget: string
  approvalText: string
}

const SAFE_ENV_TEMPLATE = /^\.env\.(example|sample|template)$/i
const SENSITIVE_DIR_SEGMENTS = new Set(['.git', '.ssh', '.aws', '.gnupg', '.kube'])
const SENSITIVE_BASENAMES = new Set([
  '.env',
  '.npmrc',
  '.netrc',
  '.pypirc',
  '.pgpass',
  'credentials',
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'secrets.toml',
  'secret.json',
  'secret.yaml',
  'secret.yml'
])
const SENSITIVE_EXTENSIONS = /\.(pem|key|p12|pfx|jks|keystore|ppk|kdbx)$/i
const PRIVATE_KEY_NAMES = /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i

function isInsideCanonical(root: string, target: string): boolean {
  const nr = normalize(root)
  const nt = normalize(target)
  const cmpRoot = process.platform === 'win32' ? nr.toLowerCase() : nr
  const cmpTarget = process.platform === 'win32' ? nt.toLowerCase() : nt
  const prefix = cmpRoot.endsWith(sep) ? cmpRoot : `${cmpRoot}${sep}`
  return cmpTarget === cmpRoot || cmpTarget.startsWith(prefix)
}

function normalizeRelative(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

function isSensitiveRelativePath(relativePath: string): boolean {
  const normalized = normalizeRelative(relativePath)
  const segments = normalized.split('/').filter(Boolean)
  for (const segment of segments) {
    if (SENSITIVE_DIR_SEGMENTS.has(segment.toLowerCase())) return true
  }
  if (segments.length >= 2 && segments[0].toLowerCase() === '.docker' && segments[1].toLowerCase() === 'config.json') {
    return true
  }
  const name = basename(normalized)
  const lower = name.toLowerCase()
  if (lower.startsWith('.env.') && !SAFE_ENV_TEMPLATE.test(lower)) return true
  if (SENSITIVE_BASENAMES.has(lower)) return true
  if (SENSITIVE_EXTENSIONS.test(lower)) return true
  if (PRIVATE_KEY_NAMES.test(lower)) return true
  return false
}

function sanitizeSessionFolder(sessionId: string): string {
  const cleaned = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64)
  return cleaned || 'session'
}

function formatEndpointLabel(endpoint: HandoffAttachmentEndpoint): string {
  const label = endpoint.label?.trim()
  return label ? `${endpoint.provider} (${label})` : `${endpoint.provider} (${endpoint.sessionId})`
}

async function resolveDirectoryRoot(rootPath: string, role: 'origin' | 'destination'): Promise<string> {
  if (!rootPath || /[\0\r\n]/.test(rootPath)) {
    throw new ActionRefused(`Invalid ${role} workspace root.`, 'invalid')
  }
  let info
  try {
    info = await stat(rootPath)
  } catch {
    throw new ActionRefused(`The ${role} workspace root does not exist.`, 'not-found')
  }
  if (!info.isDirectory()) {
    throw new ActionRefused(`The ${role} workspace root is not a directory.`, 'invalid')
  }
  return realpath(rootPath)
}

async function assertExistingAncestorInside(canonicalRoot: string, targetPath: string): Promise<void> {
  let probe = resolve(targetPath)
  while (true) {
    try {
      const canonicalProbe = await realpath(probe)
      if (!isInsideCanonical(canonicalRoot, canonicalProbe)) {
        throw new ActionRefused('Destination path resolves outside destination workspace root.', 'forbidden-path')
      }
      return
    } catch (error) {
      if (error instanceof ActionRefused) throw error
      const parent = dirname(probe)
      if (parent === probe) {
        throw new ActionRefused('Destination path could not be verified inside destination workspace root.', 'forbidden-path')
      }
      probe = parent
    }
  }
}

export function buildAttachmentApprovalText(plan: Omit<ValidatedAttachmentPlan, 'approvalTarget' | 'approvalText'>): string {
  const fileLines = plan.files.map(file => `- ${file.relativePath} (${file.size} bytes)`)
  return [
    `Origin: ${plan.origin.label} [${plan.origin.sessionId}]`,
    `Origin root: ${plan.origin.canonicalRoot}`,
    `Destination: ${plan.destination.label} [${plan.destination.sessionId}]`,
    `Destination dir: ${plan.destinationDir}`,
    `Files (${plan.files.length}, ${plan.totalBytes} bytes):`,
    ...fileLines
  ].join('\n')
}

/**
 * OXE-298 (CA-3): Validates every source and destination path before any
 * approval dialog is shown or any byte is copied.
 * Rejects path traversal (`..`), absolute paths, symlinks escaping the origin
 * root, missing/non-regular files, oversized transfers, and sensitive files
 * (`.env*`, `.git/**`, private keys, credential stores).
 */
export async function validateAttachmentTransfer(input: AttachmentTransferInput): Promise<ValidatedAttachmentPlan> {
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new ActionRefused('Provide at least one attachment file path to transfer.', 'invalid')
  }
  if (input.files.length > MAX_ATTACHMENT_FILES) {
    throw new ActionRefused(`At most ${MAX_ATTACHMENT_FILES} files may be transferred at once.`, 'invalid')
  }

  const [canonicalOriginRoot, canonicalDestinationRoot] = await Promise.all([
    resolveDirectoryRoot(input.origin.rootPath, 'origin'),
    resolveDirectoryRoot(input.destination.rootPath, 'destination')
  ])

  const defaultTarget = join('.oxespace', 'handoff-attachments', sanitizeSessionFolder(input.origin.sessionId))
  const rawTargetDir = input.targetDir?.trim() || defaultTarget
  if (/[\0\r\n]/.test(rawTargetDir) || isAbsolute(rawTargetDir) || /^[a-zA-Z]:/.test(rawTargetDir)) {
    throw new ActionRefused('targetDir must be a relative path inside the destination workspace.', 'forbidden-path')
  }
  let destinationDir: string
  try {
    destinationDir = safeJoin(canonicalDestinationRoot, rawTargetDir)
  } catch {
    throw new ActionRefused('targetDir escapes the destination workspace root.', 'forbidden-path')
  }
  const normalizedTargetRel = normalizeRelative(relative(canonicalDestinationRoot, destinationDir))
  if (normalizedTargetRel && isSensitiveRelativePath(normalizedTargetRel)) {
    throw new ActionRefused(`Refused sensitive destination path "${rawTargetDir}".`, 'forbidden-path')
  }
  await assertExistingAncestorInside(canonicalDestinationRoot, destinationDir)

  const seen = new Set<string>()
  const validated: ValidatedAttachmentFile[] = []
  let totalBytes = 0

  for (const rawFile of input.files) {
    if (typeof rawFile !== 'string' || !rawFile.trim() || /[\0\r\n]/.test(rawFile)) {
      throw new ActionRefused('Each attachment file path must be a non-empty relative string.', 'invalid')
    }
    const trimmed = rawFile.trim()
    if (isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('\\\\')) {
      throw new ActionRefused(`Attachment "${trimmed}" is out of scope: absolute paths are not allowed.`, 'forbidden-path')
    }

    let joined: string
    try {
      joined = safeJoin(canonicalOriginRoot, trimmed)
    } catch {
      throw new ActionRefused(`Attachment "${trimmed}" escapes the origin workspace root.`, 'forbidden-path')
    }

    const relFromRoot = normalizeRelative(relative(canonicalOriginRoot, joined))
    if (!relFromRoot || relFromRoot === '.' || relFromRoot.startsWith('..')) {
      throw new ActionRefused(`Attachment "${trimmed}" escapes the origin workspace root.`, 'forbidden-path')
    }
    if (isSensitiveRelativePath(relFromRoot)) {
      throw new ActionRefused(`Attachment "${relFromRoot}" is a sensitive file and cannot be transferred.`, 'forbidden-path')
    }

    let canonicalFile: string
    try {
      canonicalFile = await realpath(joined)
    } catch {
      throw new ActionRefused(`Attachment "${relFromRoot}" does not exist in the origin workspace.`, 'not-found')
    }

    if (!isInsideCanonical(canonicalOriginRoot, canonicalFile)) {
      throw new ActionRefused(`Attachment "${relFromRoot}" resolves outside the origin workspace root.`, 'forbidden-path')
    }

    const canonicalRel = normalizeRelative(relative(canonicalOriginRoot, canonicalFile))
    if (isSensitiveRelativePath(canonicalRel)) {
      throw new ActionRefused(`Attachment "${relFromRoot}" points to a sensitive file and cannot be transferred.`, 'forbidden-path')
    }

    const fileStat = await stat(canonicalFile)
    if (!fileStat.isFile()) {
      throw new ActionRefused(`Attachment "${relFromRoot}" is not a regular file.`, 'invalid')
    }
    if (fileStat.size > MAX_ATTACHMENT_FILE_BYTES) {
      throw new ActionRefused(`Attachment "${relFromRoot}" exceeds the ${MAX_ATTACHMENT_FILE_BYTES} byte per-file limit.`, 'invalid')
    }

    if (seen.has(relFromRoot)) continue
    seen.add(relFromRoot)
    totalBytes += fileStat.size
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new ActionRefused(`Total attachment size exceeds the ${MAX_ATTACHMENT_TOTAL_BYTES} byte limit.`, 'invalid')
    }

    validated.push({
      relativePath: relFromRoot,
      sourcePath: joined,
      canonicalSourcePath: canonicalFile,
      size: fileStat.size
    })
  }

  const origin = {
    sessionId: input.origin.sessionId,
    provider: input.origin.provider,
    rootPath: input.origin.rootPath,
    canonicalRoot: canonicalOriginRoot,
    label: formatEndpointLabel(input.origin)
  }
  const destination = {
    sessionId: input.destination.sessionId,
    provider: input.destination.provider,
    rootPath: input.destination.rootPath,
    canonicalRoot: canonicalDestinationRoot,
    label: formatEndpointLabel(input.destination)
  }

  const base = { origin, destination, destinationDir, files: validated, totalBytes }
  return {
    ...base,
    approvalTarget: `${origin.label} -> ${destination.label}`,
    approvalText: buildAttachmentApprovalText(base)
  }
}

/**
 * Copies files from an already-validated plan, re-checking canonical containment
 * right before each copy to prevent TOCTOU symlink swaps.
 */
export async function copyValidatedAttachments(plan: ValidatedAttachmentPlan): Promise<HandoffTransferredFile[]> {
  await assertExistingAncestorInside(plan.destination.canonicalRoot, plan.destinationDir)
  await mkdir(plan.destinationDir, { recursive: true })
  const canonicalDestDir = await realpath(plan.destinationDir)
  if (!isInsideCanonical(plan.destination.canonicalRoot, canonicalDestDir)) {
    throw new ActionRefused('Destination folder resolved outside destination workspace root.', 'forbidden-path')
  }

  const copied: HandoffTransferredFile[] = []
  for (const file of plan.files) {
    const recheckedSource = await realpath(file.sourcePath)
    if (!isInsideCanonical(plan.origin.canonicalRoot, recheckedSource)) {
      throw new ActionRefused(`Attachment "${file.relativePath}" moved outside the origin workspace root.`, 'forbidden-path')
    }
    const targetPath = safeJoin(canonicalDestDir, file.relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await assertExistingAncestorInside(canonicalDestDir, targetPath)
    await copyFile(recheckedSource, targetPath)
    const written = await stat(targetPath)
    copied.push({ relativePath: file.relativePath, destinationPath: targetPath, size: written.size })
  }
  return copied
}

/**
 * Direct ApprovalCenter-backed cross-session attachment transfer.
 * Opens an explicit confirmation via `ApprovalCenter` showing origin,
 * destination, and complete file list, and copies files ONLY after approval.
 */
export async function transferCrossSessionAttachments(
  input: AttachmentTransferInput,
  deps: { approvalCenter: Pick<ApprovalCenter, 'ask'>; requester: ApprovalRequester; signal?: AbortSignal }
): Promise<HandoffAttachmentTransferResult> {
  const plan = await validateAttachmentTransfer(input)
  const outcome = await deps.approvalCenter.ask(
    brokerDraft({
      kind: 'mcp-confirm',
      requester: deps.requester,
      level: 'medium',
      risk: 'action',
      title: mainMessage('approvals.title.agent', {}),
      summary: mainMessage('approvals.summary.mcpConfirm', {
        tool: 'oxespace_agents_change',
        action: 'transfer_attachments',
        target: plan.approvalTarget
      }),
      target: plan.approvalTarget,
      notes: [],
      text: plan.approvalText
    }),
    deps.signal
  )

  const originSummary = { sessionId: plan.origin.sessionId, provider: plan.origin.provider, label: plan.origin.label }
  const destinationSummary = { sessionId: plan.destination.sessionId, provider: plan.destination.provider, label: plan.destination.label }

  if (outcome.intent !== 'allow') {
    return {
      approved: false,
      transferred: false,
      filesCopied: 0,
      origin: originSummary,
      destination: destinationSummary,
      destinationDir: plan.destinationDir,
      files: [],
      reason: 'denied'
    }
  }

  const files = await copyValidatedAttachments(plan)
  return {
    approved: true,
    transferred: true,
    filesCopied: files.length,
    origin: originSummary,
    destination: destinationSummary,
    destinationDir: plan.destinationDir,
    files
  }
}
