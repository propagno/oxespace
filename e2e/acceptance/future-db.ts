import { writeFileSync } from 'node:fs'

/**
 * A valid, empty SQLite database whose user_version is `version`, written byte by byte: the test runner's Node cannot
 * load the Electron build of better-sqlite3. One 4 KiB page: the 100-byte header, then an empty table b-tree leaf for
 * sqlite_master. Opening it is what a newer OXESpace's database looks like to this one (T87).
 */
export function writeFutureDatabase(path: string, version: number): void {
  const page = 4096
  const file = Buffer.alloc(page)
  file.write('SQLite format 3\0', 0, 'latin1')
  file.writeUInt16BE(page, 16) // page size
  file[18] = 1; file[19] = 1 // legacy write and read formats (no WAL in the file itself)
  file[20] = 0 // reserved bytes per page
  file[21] = 64; file[22] = 32; file[23] = 32 // payload fractions, fixed by the format
  file.writeUInt32BE(1, 24) // file change counter
  file.writeUInt32BE(1, 28) // size in pages
  file.writeUInt32BE(0, 32); file.writeUInt32BE(0, 36) // no freelist
  file.writeUInt32BE(1, 40) // schema cookie
  file.writeUInt32BE(4, 44) // schema format
  file.writeUInt32BE(1, 56) // UTF-8
  file.writeUInt32BE(version, 60) // user_version
  file.writeUInt32BE(1, 92) // version-valid-for = change counter
  file.writeUInt32BE(3_045_000, 96) // SQLite version that wrote it
  file[100] = 0x0d // table b-tree leaf
  file.writeUInt16BE(0, 101) // no freeblock
  file.writeUInt16BE(0, 103) // no cells
  file.writeUInt16BE(page, 105) // cell content starts at the page end
  file[107] = 0 // no fragmented bytes
  writeFileSync(path, file)
}
