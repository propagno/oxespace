#!/usr/bin/env node
/**
 * Writes the Android app's generated sources from the desktop's contracts: the C5 protocol, the C4 design tokens and
 * the `mobile` translation catalogs. Run after any of them changes: npm run android:generate.
 * `tests/android-generated.test.ts` fails when a committed file is out of date.
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { PROTOCOL_KOTLIN_PATH, protocolKotlin } from './protocol-kotlin.mjs'
import { STRINGS_XML_PATHS, stringsXml } from './strings-xml.mjs'
import { THEME_KOTLIN_PATH, themeKotlin } from './theme-kotlin.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

async function load(name, contents) {
  const outfile = join(tmpdir(), `oxespace-android-${name}-${process.pid}.mjs`)
  await build({ stdin: { contents, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'warning' })
  return import(pathToFileURL(outfile).href)
}

function write(path, text) {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text)
  console.log(`[android] wrote ${target}`)
}

const protocolSource = readFileSync(join(root, 'shared/remote/protocol.ts'), 'utf8')
write(PROTOCOL_KOTLIN_PATH, protocolKotlin(protocolSource, await load('protocol', "export * from './shared/remote/protocol'")))

const tokens = await load('tokens', [
  "export { colorRoles } from './src/design/tokens/semantic'",
  "export { IDENTITY } from './src/design/tokens/palette'",
  "export { SPACE, RADIUS, TEXT, WEIGHT, LEADING, MOTION, REDUCED_MOTION } from './src/design/tokens/scales'"
].join('\n'))
write(THEME_KOTLIN_PATH, themeKotlin(tokens))

const catalog = language => JSON.parse(readFileSync(join(root, 'shared/locales', language, 'mobile.json'), 'utf8'))
for (const [language, path] of Object.entries(STRINGS_XML_PATHS)) write(path, stringsXml(catalog('en'), catalog(language), language))
