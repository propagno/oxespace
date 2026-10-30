#!/usr/bin/env node
/**
 * Writes the app icon from its single source, src/design/brand.ts (geometry) and the --logo-* tokens (colors):
 *   resources/icon.svg                the vector, also the window favicon
 *   resources/icons/<n>x<n>.png       16–1024 px for Linux, macOS and the installers
 *   resources/icon.png                512 px, the window icon on Linux
 *   resources/icon.ico                16–256 px for Windows
 *   docs/assets/logo.png              256 px, the README banner
 * Run after changing the mark or its colors:  npm run generate:icon
 * tests/brand-touchpoints.test.ts fails when the committed files drift from the source.
 */
import { Resvg } from '@resvg/resvg-js'
import { build } from 'esbuild'
import pngToIco from 'png-to-ico'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(tmpdir(), `oxespace-brand-${process.pid}.mjs`)
await build({ entryPoints: [join(root, 'src/design/brand.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'warning' })
const { appIconSvg, ICON_SIZES, ICO_SIZES } = await import(pathToFileURL(outfile).href)

const svg = appIconSvg()
const resources = join(root, 'resources')
writeFileSync(join(resources, 'icon.svg'), svg)

const render = size => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
const pngs = new Map([...new Set([...ICON_SIZES, ...ICO_SIZES])].map(size => [size, render(size)]))

mkdirSync(join(resources, 'icons'), { recursive: true })
for (const size of ICON_SIZES) writeFileSync(join(resources, 'icons', `${size}x${size}.png`), pngs.get(size))
writeFileSync(join(resources, 'icon.png'), pngs.get(512))
writeFileSync(join(resources, 'icon.ico'), await pngToIco(ICO_SIZES.map(size => pngs.get(size))))
writeFileSync(join(root, 'docs', 'assets', 'logo.png'), pngs.get(256))

console.log('✓ resources/icon.svg')
console.log(`✓ resources/icons  (${ICON_SIZES.join(', ')} px)`)
console.log('✓ resources/icon.png  (512 px)')
console.log(`✓ resources/icon.ico  (${ICO_SIZES.join(', ')} px)`)
console.log('✓ docs/assets/logo.png  (256 px)')
