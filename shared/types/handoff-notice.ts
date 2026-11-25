/**
 * OXE-298: shared contracts for cross-provider handoff inbound notices,
 * watched handoff files, and cross-session attachment transfers.
 */

export interface HandoffNoticeOrigin {
  paneId?: string | null
  sessionId?: string | null
  provider?: string | null
  label: string
}

export interface HandoffInboundNotice {
  id: string
  consumerPaneId: string
  kind: 'file-changed' | 'peer-reply'
  origin: HandoffNoticeOrigin
  filePath: string | null
  relativePath: string | null
  contentHash: string | null
  mtimeMs: number | null
  summary: string | null
  /** Inbound notices are always passive and must never steal typing focus. */
  stealFocus: false
  timestampUtc: string
}

export interface HandoffAttachmentEndpoint {
  sessionId: string
  provider: string
  rootPath: string
  label?: string
}

export interface HandoffTransferredFile {
  relativePath: string
  destinationPath: string
  size: number
}

export interface HandoffAttachmentTransferResult {
  approved: boolean
  transferred: boolean
  filesCopied: number
  origin: { sessionId: string; provider: string; label: string }
  destination: { sessionId: string; provider: string; label: string }
  destinationDir: string
  files: HandoffTransferredFile[]
  reason?: 'denied'
}
