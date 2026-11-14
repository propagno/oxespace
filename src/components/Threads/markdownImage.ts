/**
 * Which images an answer may show. An image an agent writes into its answer is a request the agent makes on the
 * person's behalf: one that goes to the network tells a server that the answer was read, and can carry text in its
 * address. So only two kinds are drawn: an image the answer carries itself (`data:`), and an image file of the
 * project. Anything else stays a reference the person may open.
 */

const INLINE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/
/** A capture or a small chart; past this an inline image is a dump, shown as a reference. */
export const MAX_INLINE_IMAGE_CHARS = 4_000_000
/** A project image larger than this is not read into the window. */
export const MAX_PROJECT_IMAGE_BYTES = 6 * 1024 * 1024
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp)$/i

/** The `data:` address as written, when it is a raster image of a size worth drawing; null otherwise. */
export function inlineImageSource(src: string | undefined): string | null {
  if (!src || src.length > MAX_INLINE_IMAGE_CHARS) return null
  return INLINE.test(src) ? src : null
}

/**
 * An image file inside the project, as a path relative to its root; null for an address with a scheme, a path that
 * leaves the project, or a file that is not a raster image.
 */
export function projectImagePath(src: string | undefined, rootPath: string): string | null {
  if (!src || src.length > 1024 || !rootPath) return null
  let value = src.trim().replace(/[?#].*$/, '')
  try { value = decodeURIComponent(value) } catch { /* as written */ }
  value = value.replace(/\\/g, '/')
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const drive = /^[A-Za-z]:\//
  if (drive.test(value) || value.startsWith('/')) {
    const insensitive = drive.test(root)
    const head = value.slice(0, root.length)
    if (value.length <= root.length || value[root.length] !== '/' || (insensitive ? head.toLowerCase() !== root.toLowerCase() : head !== root)) return null
    value = value.slice(root.length + 1)
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null
  value = value.replace(/^(\.\/)+/, '')
  // eslint-disable-next-line no-control-regex
  if (!value || !IMAGE_FILE.test(value) || /[\u0000-\u001f]/.test(value) || value.split('/').some(part => part === '' || part === '.' || part === '..')) return null
  return value
}
