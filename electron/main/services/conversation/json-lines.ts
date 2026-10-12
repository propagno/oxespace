/** Bounded UTF-8 JSONL framing shared by agent adapters, never ANSI parsing. */
export class JsonLinesDecoder {
  private buffer = ''
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })
  private failed = false

  constructor(private readonly emit: (value: unknown) => void, private readonly maxBytes = 1024 * 1024) {}

  push(chunk: Uint8Array): void {
    if (this.failed) throw new Error('Agent stream decoder is closed')
    try {
      this.buffer += this.decoder.decode(chunk, { stream: true })
      this.consume(false)
    } catch (error) {
      this.failed = true
      this.buffer = ''
      throw error
    }
  }

  finish(): void {
    if (this.failed) throw new Error('Agent stream decoder is closed')
    try {
      this.buffer += this.decoder.decode()
      this.consume(true)
    } finally {
      this.failed = true
      this.buffer = ''
    }
  }

  private consume(final: boolean): void {
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      this.parse(line)
    }
    this.checkSize(this.buffer)
    if (final && this.buffer.trim()) this.parse(this.buffer)
  }

  private checkSize(line: string): void {
    if (Buffer.byteLength(line, 'utf8') > this.maxBytes) throw new Error('Agent protocol message exceeds size limit')
  }

  private parse(line: string): void {
    this.checkSize(line)
    if (!line.trim()) return
    let value: unknown
    try { value = JSON.parse(line) } catch { throw new Error('Invalid JSON in agent protocol stream') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected agent protocol object')
    this.emit(value)
  }
}
