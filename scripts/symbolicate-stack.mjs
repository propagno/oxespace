/**
 * Turns the minified main-process frames of a stack trace (from a problem report, main.log or a crash dialog) back
 * into source files and lines, using the private source maps the build writes next to each chunk in out/main.
 *
 *   node scripts/symbolicate-stack.mjs --maps <out/main of the same build> [stack.txt]   (stdin when no file)
 *
 * The maps never ship in the app; CI keeps them as the `main-sourcemaps` artifact of each build. A frame whose
 * chunk has no map, or whose position the map does not cover, is left exactly as it was.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const DIGIT = new Map([...BASE64].map((char, index) => [char, index]))

/** One field group of a `mappings` segment, as base64 VLQ. Throws on anything that is not VLQ. */
function decodeSegment(text) {
  const values = []
  let value = 0
  let shift = 0
  for (const char of text) {
    const digit = DIGIT.get(char)
    if (digit === undefined) throw new Error(`Invalid source map: "${char}" is not a base64 VLQ digit`)
    value += (digit & 31) << shift
    if (digit & 32) { shift += 5; if (shift > 30) throw new Error('Invalid source map: a VLQ value is too long'); continue }
    values.push(value & 1 ? -(value >>> 1) : value >>> 1)
    value = 0
    shift = 0
  }
  if (shift) throw new Error('Invalid source map: a VLQ value is cut short')
  if (![1, 4, 5].includes(values.length)) throw new Error(`Invalid source map: a segment has ${values.length} fields`)
  return values
}

/**
 * Decodes `mappings` into one sorted array of segments per generated line:
 * [generatedColumn, sourceIndex?, sourceLine?, sourceColumn?, nameIndex?], all zero-based and absolute.
 */
export function decodeMappings(mappings) {
  if (typeof mappings !== 'string') throw new Error('Invalid source map: mappings is not a string')
  let source = 0, line = 0, column = 0, name = 0
  return mappings.split(';').map(group => {
    let generated = 0
    const segments = group ? group.split(',').map(text => {
      const fields = decodeSegment(text)
      generated += fields[0]
      if (fields.length === 1) return [generated]
      source += fields[1]; line += fields[2]; column += fields[3]
      if (fields.length === 4) return [generated, source, line, column]
      name += fields[4]
      return [generated, source, line, column, name]
    }) : []
    return segments.sort((a, b) => a[0] - b[0])
  })
}

/** Checks the parts of a version 3 map that the lookup reads, so a wrong file fails here and not with a bad answer. */
export function parseSourceMap(text) {
  let map
  try { map = JSON.parse(text) } catch { throw new Error('Invalid source map: not JSON') }
  if (!map || map.version !== 3) throw new Error('Invalid source map: only version 3 maps are supported')
  if (!Array.isArray(map.sources)) throw new Error('Invalid source map: sources is missing')
  return { sources: map.sources, names: Array.isArray(map.names) ? map.names : [], lines: decodeMappings(map.mappings) }
}

/**
 * The original position of a generated one-based line and column, as a V8 stack frame prints them, or null when
 * the map does not cover it. The source path stays as the map has it (relative to the map's folder).
 */
export function originalPosition(map, line, column) {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null
  const segments = map.lines[line - 1]
  if (!segments?.length) return null
  let found = null
  for (const segment of segments) {
    if (segment[0] > column - 1) break
    found = segment
  }
  if (!found || found.length < 4 || map.sources[found[1]] === undefined) return null
  return { source: map.sources[found[1]], line: found[2] + 1, column: found[3] + 1, name: found.length === 5 ? map.names[found[4]] ?? null : null }
}

// A main-process location: any prefix (app.asar, a %USERPROFILE% path, file:///), then out/main/[chunks/]x.js:line:col.
// Inside "at fn (...)" the prefix may hold spaces (C:\Program Files); a bare "at <location>" frame ends at a space.
const LOCATION = String.raw`out[\\/]main[\\/]((?:chunks[\\/])?[\w.-]+\.js):(\d+):(\d+)`
const FRAME = new RegExp(String.raw`(\()[^()\n]*?${LOCATION}(?=\))|()[^\s()'"]*?${LOCATION}`, 'g')

/**
 * Rewrites every main-process frame in `text`. `loadMap(file)` gets a path relative to out/main with forward slashes
 * ("index.js", "chunks/x-abc.js") and returns a parsed map or null. Returns the text and how many frames it mapped.
 */
export function symbolicateStack(text, loadMap) {
  let mapped = 0
  let unmapped = 0
  const result = String(text).replace(FRAME, (frame, paren, pFile, pLine, pColumn, bare, bFile, bLine, bColumn) => {
    const [open, file, line, column] = paren ? [paren, pFile, pLine, pColumn] : ['', bFile, bLine, bColumn]
    const chunk = file.replaceAll('\\', '/')
    const map = loadMap(chunk)
    const position = map ? originalPosition(map, Number(line), Number(column)) : null
    if (!position) { unmapped++; return frame }
    mapped++
    // Map sources are relative to the map, which sits next to its chunk in out/main.
    const source = posix.normalize(posix.join('out/main', posix.dirname(chunk), position.source))
    return `${open}${source}:${position.line}:${position.column}`
  })
  return { text: result, mapped, unmapped }
}

/** Loads maps from a build's out/main folder, each one once, refusing names that would leave the folder. */
export function mapLoader(directory) {
  const cache = new Map()
  return chunk => {
    if (cache.has(chunk)) return cache.get(chunk)
    const path = join(directory, `${chunk}.map`)
    const map = /(^|\/)\.\.(\/|$)/.test(chunk) || !existsSync(path) ? null : parseSourceMap(readFileSync(path, 'utf8'))
    cache.set(chunk, map)
    return map
  }
}

function main(argv) {
  const at = argv.indexOf('--maps')
  const directory = at >= 0 ? argv[at + 1] : undefined
  const rest = argv.filter((_, index) => index !== at && index !== at + 1)
  if (!directory || rest.length > 1) {
    console.error('Usage: node scripts/symbolicate-stack.mjs --maps <out/main folder with the .map files> [stack.txt]')
    return 2
  }
  if (!existsSync(join(directory, 'index.js.map'))) {
    console.error(`No index.js.map in ${directory}. Use the out/main of the same build (CI artifact main-sourcemaps).`)
    return 2
  }
  const input = readFileSync(rest[0] ?? 0, 'utf8')
  const { text, mapped, unmapped } = symbolicateStack(input, mapLoader(directory))
  process.stdout.write(text)
  console.error(`[symbolicate] ${mapped} frame(s) mapped, ${unmapped} left as they were`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2))
