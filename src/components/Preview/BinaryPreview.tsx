import { useState, type ReactElement } from 'react'
import { useBinaryPreview } from './useBinaryPreview'

interface BinaryPreviewProps {
  workspaceId: string
  rootPath: string
  relativePath: string
  kind: 'image' | 'pdf'
}

/**
 * #10 · Viewer for the binary preview kinds. Images use a `data:` URI (allowed by
 * `img-src 'self' data: blob:`); PDFs use a blob object URL in a frame, which the
 * packaged CSP must list under `frame-src`.
 */
export function BinaryPreview({ kind, relativePath, rootPath, workspaceId }: BinaryPreviewProps): ReactElement {
  const preview = useBinaryPreview({ workspaceId, rootPath, relativePath })
  const [zoomed, setZoomed] = useState(false)

  if (preview.isLoading) return <div className="editor-loading">Loading preview</div>
  if (preview.error) return <div className="editor-error">{preview.error}</div>
  if (!preview.data) return <div className="editor-empty">Select a file</div>

  if (kind === 'pdf') {
    return (
      <div className="binary-preview binary-preview-pdf" data-testid="pdf-preview">
        <iframe title={relativePath} src={preview.blobUrl ?? undefined} />
      </div>
    )
  }

  return (
    <div className="binary-preview binary-preview-image" data-testid="image-preview">
      <button
        type="button"
        className={`binary-preview-canvas${zoomed ? ' zoomed' : ''}`}
        onClick={() => setZoomed((value) => !value)}
        title={zoomed ? 'Click to fit' : 'Click to view at full size'}
      >
        <img src={preview.dataUri ?? undefined} alt={relativePath} />
      </button>
      <footer className="binary-preview-meta">
        <span>{preview.data.mimeType}</span>
        <span>{formatBytes(preview.data.size)}</span>
      </footer>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
