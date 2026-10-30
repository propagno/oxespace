import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useBinaryPreview } from './useBinaryPreview'
import { EmptyState, ErrorState, LoadingState } from '../../ui'
import { formatNumber } from '../../utils/formatTime'

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
  const { t } = useTranslation('code')
  const preview = useBinaryPreview({ workspaceId, rootPath, relativePath })
  const [zoomed, setZoomed] = useState(false)

  if (preview.isLoading) return <LoadingState label={t('editor.loadingPreview')} />
  if (preview.error) return <ErrorState compact title={t('editor.previewFailed')} message={preview.error} />
  if (!preview.data) return <EmptyState compact title={t('editor.selectFile')} />

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
        aria-pressed={zoomed}
        title={zoomed ? t('editor.fit') : t('editor.fullSize')}
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

/** 512 B, 1.5 KB, 2.3 MB, with the decimal separator of the interface language. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatNumber(bytes)} B`
  const one = { minimumFractionDigits: 1, maximumFractionDigits: 1 }
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, one)} KB`
  return `${formatNumber(bytes / (1024 * 1024), one)} MB`
}
