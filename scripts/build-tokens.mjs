#!/usr/bin/env node
/**
 * Writes src/styles/tokens.generated.css from the token source in
 * src/design/tokens. Run after editing a token:  npm run tokens
 * `tests/design-tokens.test.ts` fails when the committed file is out of date.
 */
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(tmpdir(), `oxespace-tokens-${process.pid}.mjs`)
await build({ entryPoints: [join(root, 'src/design/tokens/css.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'warning' })
const { tokensCss } = await import(pathToFileURL(outfile).href)
const target = join(root, 'src/styles/tokens.generated.css')
writeFileSync(target, tokensCss())
console.log(`[tokens] wrote ${target}`)
