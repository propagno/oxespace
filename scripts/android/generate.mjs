#!/usr/bin/env node
/**
 * Writes the Android app's generated sources from the desktop's contracts. Run after a contract changes:
 * npm run android:generate. `tests/android-generated.test.ts` fails when a committed file is out of date.
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { PROTOCOL_KOTLIN_PATH, protocolKotlin } from './protocol-kotlin.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const protocolSource = join(root, 'shared/remote/protocol.ts')
const outfile = join(tmpdir(), `oxespace-remote-protocol-${process.pid}.mjs`)
await build({ entryPoints: [protocolSource], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'warning' })
const values = await import(pathToFileURL(outfile).href)

const target = join(root, PROTOCOL_KOTLIN_PATH)
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, protocolKotlin(readFileSync(protocolSource, 'utf8'), values))
console.log(`[android] wrote ${target}`)
