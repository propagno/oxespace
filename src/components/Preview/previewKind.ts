/** #10 · Rich previews — classify a file by extension so the editor can pick a
 *  viewer instead of feeding binary through the text editor. */

export type PreviewKind = 'markdown' | 'image' | 'pdf' | 'text'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg'])
const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx'])

export function previewKind(relativePath: string): PreviewKind {
  const ext = relativePath.split('.').pop()?.toLowerCase() ?? ''
  if (MARKDOWN_EXTS.has(ext)) return 'markdown'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return 'text'
}

/** Binary kinds must not go through the utf-8 text read path. */
export function isBinaryPreview(kind: PreviewKind): kind is 'image' | 'pdf' {
  return kind === 'image' || kind === 'pdf'
}
