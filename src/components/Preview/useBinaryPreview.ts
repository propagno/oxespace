import { useEffect, useState } from 'react'
import type { FileSystemReadBinaryResult } from '../../../shared/types/filesystem'

export interface BinaryPreviewState {
  data: FileSystemReadBinaryResult | null
  /** `data:` URI — CSP allows it for img-src. */
  dataUri: string | null
  /** Blob object URL — needed for frames (PDF), revoked on change/unmount. */
  blobUrl: string | null
  isLoading: boolean
  error: string | null
}

const IDLE: BinaryPreviewState = { data: null, dataUri: null, blobUrl: null, isLoading: false, error: null }

/**
 * #10 · Reads a binary file over `fs:read-binary` and exposes it both as a
 * `data:` URI (images) and as a blob object URL (frames). Blob URLs are revoked
 * when the target file changes so long sessions don't leak megabytes.
 */
export function useBinaryPreview(
  input: { workspaceId: string; rootPath: string; relativePath: string } | null
): BinaryPreviewState {
  const [state, setState] = useState<BinaryPreviewState>(IDLE)
  const workspaceId = input?.workspaceId ?? null
  const rootPath = input?.rootPath ?? null
  const relativePath = input?.relativePath ?? null

  useEffect(() => {
    if (!workspaceId || !rootPath || !relativePath) {
      setState(IDLE)
      return undefined
    }

    let cancelled = false
    let createdUrl: string | null = null
    setState({ ...IDLE, isLoading: true })

    void window.oxe.fs
      .readBinary({ workspaceId, rootPath, relativePath })
      .then((result) => {
        if (cancelled) return
        const dataUri = `data:${result.mimeType};base64,${result.base64}`
        createdUrl = URL.createObjectURL(toBlob(result.base64, result.mimeType))
        setState({ data: result, dataUri, blobUrl: createdUrl, isLoading: false, error: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({ ...IDLE, error: error instanceof Error ? error.message : 'Failed to read file' })
      })

    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [workspaceId, rootPath, relativePath])

  return state
}

function toBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}
