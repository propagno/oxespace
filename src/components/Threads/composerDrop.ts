/**
 * Drag-and-drop payload extraction for the OxeChat composer (OXE-478):
 * accepts OS files, OS folders, workspace explorer drags (`application/oxe-file-path`),
 * `text/uri-list` drops, and image attachments cleanly in one unified pipeline.
 */
import {
  createFileContextItem,
  parseUriList,
  type ComposerContextItem
} from '../../../shared/types/composer-context'

export const OXE_FILE_PATH_MIME = 'application/oxe-file-path'
export const OXE_FILE_KIND_MIME = 'application/oxe-file-kind'

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function isSupportedImageFile(file: File): boolean {
  return IMAGE_MIME_TYPES.has(file.type) || file.type.startsWith('image/')
}

export function hasDroppablePayload(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false
  const types = Array.from(dataTransfer.types ?? [])
  if (types.includes('Files') || types.includes(OXE_FILE_PATH_MIME) || types.includes('text/uri-list')) return true
  if ((dataTransfer.files?.length ?? 0) > 0) return true
  return Array.from(dataTransfer.items ?? []).some(item => item.kind === 'file')
}

interface WebkitEntryLike {
  isDirectory?: boolean
}

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => WebkitEntryLike | null
}

type FileWithPath = File & { path?: string }

function detectDroppedKind(file: File, rawPath: string, item?: DataTransferItem): 'file' | 'folder' {
  const entry = (item as DataTransferItemWithEntry | undefined)?.webkitGetAsEntry?.()
  if (entry?.isDirectory === true) return 'folder'
  if (rawPath.endsWith('/') || rawPath.endsWith('\\')) return 'folder'
  const base = rawPath.split(/[\\/]/).pop() ?? file.name
  if (file.type === '' && file.size === 0 && base && !/\.[a-z0-9]{1,10}$/i.test(base)) return 'folder'
  return 'file'
}

export interface DroppedComposerPayload {
  images: File[]
  contextItems: ComposerContextItem[]
}

/**
 * Extracts images and non-image file/folder context chips from a drop event.
 * Deduplicates non-image items by normalized ID within the dropped batch.
 */
export function extractDroppedPayload(
  dataTransfer: DataTransfer | null | undefined,
  rootPath?: string,
  getPathForFile?: (file: File) => string
): DroppedComposerPayload {
  if (!dataTransfer) return { images: [], contextItems: [] }

  const images: File[] = []
  const contextItems: ComposerContextItem[] = []
  const seen = new Set<string>()
  const pushContext = (item: ComposerContextItem | null): void => {
    if (!item || seen.has(item.id)) return
    seen.add(item.id)
    contextItems.push(item)
  }

  const files = Array.from(dataTransfer.files ?? [])
  const items = Array.from(dataTransfer.items ?? [])
  if (files.length > 0) {
    files.forEach((file, index) => {
      if (isSupportedImageFile(file)) {
        images.push(file)
        return
      }
      const fromWebUtils = getPathForFile?.(file) || ''
      const fromFilePath = (file as FileWithPath).path || ''
      const rawPath = fromWebUtils || fromFilePath || file.webkitRelativePath || file.name
      if (!rawPath) return
      const kind = detectDroppedKind(file, rawPath, items[index])
      pushContext(createFileContextItem(rawPath, rootPath, kind))
    })
  }

  // Internal workspace FileBrowser drag (`application/oxe-file-path`).
  if (images.length === 0 && contextItems.length === 0 && typeof dataTransfer.getData === 'function') {
    const oxePath = dataTransfer.getData(OXE_FILE_PATH_MIME)
    if (oxePath) {
      const oxeKind = dataTransfer.getData(OXE_FILE_KIND_MIME)
      const kind: 'file' | 'folder' = oxeKind === 'directory' || oxePath.endsWith('/') || oxePath.endsWith('\\')
        ? 'folder'
        : 'file'
      pushContext(createFileContextItem(oxePath, rootPath, kind))
    }
  }

  // External URI list drops (`text/uri-list`, e.g. from OS explorer or external editor).
  if (images.length === 0 && contextItems.length === 0 && typeof dataTransfer.getData === 'function') {
    const uriList = dataTransfer.getData('text/uri-list')
    for (const uri of parseUriList(uriList)) {
      const kind: 'file' | 'folder' = uri.endsWith('/') ? 'folder' : 'file'
      pushContext(createFileContextItem(uri, rootPath, kind))
    }
  }

  return { images, contextItems }
}
