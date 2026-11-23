'use strict'
// OXE-400: the program that runs inside the PTY and prints.
//   gen.cjs bytes <n> <plain|ansi> <tag>   prints n bytes as fast as the PTY takes them, then the end marker
//   gen.cjs rate <bytesPerSecond> <seconds> <plain|ansi>   prints at a steady rate (the load of the echo test)
const { writeSync } = require('node:fs')

const [mode, a, b, c] = process.argv.slice(2)
const WIDTH = 78

function line(index, kind) {
  const words = []
  let length = 0
  let word = index
  while (length < WIDTH) {
    const text = `w${(word++ % 9973).toString(36)}`
    words.push(kind === 'ansi' ? `\x1b[3${word % 8}m${text}\x1b[0m` : text)
    length += text.length + 1
  }
  return `${words.join(' ')}\r\n`
}

function chunk(start, kind, size) {
  let out = ''
  let index = start
  while (out.length < size) out += line(index++, kind)
  return { text: out, next: index }
}

function write(text) {
  let buffer = Buffer.from(text)
  while (buffer.length > 0) {
    try {
      const written = writeSync(1, buffer)
      buffer = buffer.subarray(written)
    } catch (error) {
      if (error.code !== 'EAGAIN') throw error
    }
  }
}

if (mode === 'bytes') {
  const total = Number(a)
  const kind = b
  let sent = 0
  let index = 0
  while (sent < total) {
    const part = chunk(index, kind, Math.min(64 * 1024, total - sent))
    index = part.next
    write(part.text)
    sent += Buffer.byteLength(part.text)
  }
  write(`\r\n__POC_END_${c}__\r\n`)
  // Stay a moment so the PTY hands over the last frame before the process is gone.
  setTimeout(() => process.exit(0), 500)
} else if (mode === 'rate') {
  const perSecond = Number(a)
  const seconds = Number(b)
  const kind = c
  const tick = 20
  const perTick = Math.max(1, Math.round((perSecond * tick) / 1000))
  let index = 0
  const timer = setInterval(() => {
    const part = chunk(index, kind, perTick)
    index = part.next
    write(part.text)
  }, tick)
  setTimeout(() => { clearInterval(timer); process.exit(0) }, seconds * 1000)
} else {
  process.stderr.write('usage: gen.cjs bytes <n> <plain|ansi> <tag> | rate <bytesPerSecond> <seconds> <plain|ansi>\n')
  process.exit(2)
}
