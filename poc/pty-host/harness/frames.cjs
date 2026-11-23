'use strict'
// OXE-400 arm D: the framing of rust/bin-host (kind u8, id u32 LE, length u32 LE, payload).
const KIND = { SPAWN: 1, WRITE: 2, RESIZE: 3, KILL: 4, CRASH: 5, SPAWNED: 101, DATA: 102, EXIT: 103, ERROR: 104 }

function encode(kind, id, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  const header = Buffer.alloc(9)
  header.writeUInt8(kind, 0)
  header.writeUInt32LE(id >>> 0, 1)
  header.writeUInt32LE(body.length, 5)
  return Buffer.concat([header, body])
}

function spawnPayload({ file, args, cwd, env, cols, rows }) {
  const envPairs = Object.entries(env).map(([key, value]) => `${key}=${value}`)
  return Buffer.from([file, cwd ?? '', String(cols), String(rows), String(args.length), ...args, String(envPairs.length), ...envPairs].join('\0'))
}

/** Feeds stdout chunks; calls onFrame(kind, id, payload) for each complete frame. */
function decoder(onFrame) {
  let pending = Buffer.alloc(0)
  return (chunk) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
    while (pending.length >= 9) {
      const length = pending.readUInt32LE(5)
      if (pending.length < 9 + length) break
      const kind = pending.readUInt8(0)
      const id = pending.readUInt32LE(1)
      const payload = pending.subarray(9, 9 + length)
      pending = pending.subarray(9 + length)
      onFrame(kind, id, payload)
    }
  }
}

module.exports = { KIND, encode, spawnPayload, decoder }
