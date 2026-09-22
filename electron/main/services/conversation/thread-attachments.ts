import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import type { ThreadAttachment } from '../../../../shared/types/thread'

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const extensions: Record<ThreadAttachment['mimeType'], string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif'
}

function matchesMime(data: Buffer, mime: ThreadAttachment['mimeType']): boolean {
  if (mime === 'image/png') return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mime === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data.at(-2) === 0xff && data.at(-1) === 0xd9
  if (mime === 'image/gif') return data.subarray(0, 6).toString('ascii') === 'GIF87a' || data.subarray(0, 6).toString('ascii') === 'GIF89a'
  return data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP'
}

/** Private blob store. Renderer receives opaque ids and never supplies filesystem paths. */
export class ThreadAttachmentStore {
  constructor(private readonly root: string) {}

  async add(threadId: string, input: { name: string; mimeType: ThreadAttachment['mimeType']; data: ArrayBuffer | Uint8Array }): Promise<ThreadAttachment> {
    if (!extensions[input.mimeType]) throw Error('Unsupported attachment type')
    const data = Buffer.from(input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data))
    if (!data.length || data.length > MAX_ATTACHMENT_BYTES || !matchesMime(data, input.mimeType)) throw Error('Invalid image attachment')
    const hash = createHash('sha256').update(data).digest('hex'), id = `${hash}-${randomUUID().slice(0, 8)}`
    const directory = this.directory(threadId), path = join(directory, id + extensions[input.mimeType])
    await mkdir(directory, { recursive: true })
    const attachment: ThreadAttachment = { id, name: basename(input.name).slice(0, 180) || `image${extensions[input.mimeType]}`, mimeType: input.mimeType, bytes: data.length }
    await writeFile(path, data, { flag: 'wx' })
    try { await writeFile(join(directory, `${id}.json`), JSON.stringify(attachment), { flag: 'wx' }) }
    catch (error) { await unlink(path).catch(() => {}); throw error }
    return attachment
  }

  async resolve(threadId: string, ids: string[]): Promise<ThreadAttachment[]> {
    if (ids.length > 8 || new Set(ids).size !== ids.length) throw Error('Invalid attachment selection')
    const directory = this.directory(threadId)
    return Promise.all(ids.map(async id => {
      if (!/^[a-f0-9]{64}-[a-f0-9]{8}$/.test(id)) throw Error('Invalid attachment identifier')
      const metadata = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8')) as ThreadAttachment
      if (metadata.id !== id || !extensions[metadata.mimeType]) throw Error('Invalid attachment metadata')
      const path = join(directory, id + extensions[metadata.mimeType]), info = await stat(path)
      if (!info.isFile() || info.size !== metadata.bytes || info.size > MAX_ATTACHMENT_BYTES) throw Error('Attachment is unavailable')
      return { ...metadata, path }
    }))
  }

  async remove(threadId: string, id: string): Promise<void> {
    const [attachment] = await this.resolve(threadId, [id])
    await Promise.allSettled([unlink(attachment.path!), unlink(join(this.directory(threadId), `${id}.json`))])
  }

  async removeThread(threadId: string): Promise<void> {
    await rm(this.directory(threadId), { recursive: true, force: true })
  }

  private directory(threadId: string): string {
    if (!/^[a-z0-9-]{1,80}$/i.test(threadId)) throw Error('Invalid thread identifier')
    const directory = resolve(this.root, threadId), base = resolve(this.root), relation = relative(base, directory)
    if (!relation || relation.startsWith('..') || isAbsolute(relation)) throw Error('Invalid attachment directory')
    return directory
  }
}
