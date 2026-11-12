import type { PreviewAttachment } from './WebPreviewPanel'

/** A capture of the preview (a PNG data: URI) as the file the conversation's attach flow takes. Null when it is not one. */
export function attachmentFile(image: PreviewAttachment): File | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl)
  if (!match) return null
  const binary = atob(match[1])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], image.name, { type: 'image/png' })
}
