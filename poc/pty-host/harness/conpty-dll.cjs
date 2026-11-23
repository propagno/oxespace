'use strict'
// OXE-400: prints the conpty.dll that node-pty loads with useConptyDll, in node-pty's own search order
// (build/Release, then prebuilds/<platform>-<arch>), so the Rust arms preload the same ConPTY.
const { existsSync } = require('node:fs')
const { dirname, join } = require('node:path')

const root = dirname(require.resolve('node-pty/package.json', { paths: [join(__dirname, '..', '..', '..')] }))
for (const dir of ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`]) {
  const file = join(root, dir, 'conpty', 'conpty.dll')
  if (existsSync(file)) {
    process.stdout.write(file)
    process.exit(0)
  }
}
process.stderr.write('node-pty ships no conpty.dll here\n')
process.exit(1)
