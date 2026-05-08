import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const svgData = readFileSync(join(root, 'resources', 'icon.svg'))

mkdirSync(join(root, 'resources'), { recursive: true })

const sizes = [16, 32, 48, 64, 128, 256]

const pngs = sizes.map((size) => {
  const resvg = new Resvg(svgData, {
    fitTo: { mode: 'width', value: size }
  })
  return resvg.render().asPng()
})

writeFileSync(join(root, 'resources', 'icon.png'), pngs[pngs.length - 1])

const ico = await pngToIco(pngs)
writeFileSync(join(root, 'resources', 'icon.ico'), ico)

console.log('✓ resources/icon.png')
console.log('✓ resources/icon.ico  (' + sizes.join(', ') + ' px)')
