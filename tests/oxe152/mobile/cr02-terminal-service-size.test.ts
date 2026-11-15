// CR-02 (Celular F2, 14/11): T3 (OXE-52, a restarted pane keeps the desktop size) took
// electron/main/services/terminal.service.ts from 1000 to 1005 lines. `npm run lint` runs
// scripts/check-file-size.mjs, which fails any tracked .ts file past 1000 lines, so PR #808 failed
// "Quick checks (linux-x64)".
//
// Contract for the redo of T3: the restart behaviour of A3 stays (t18-terminal-desktop.test.ts -t "A3"),
// and terminal.service.ts adds no net line. What grows goes under electron/main/services/terminal/
// (size-lease.ts or a module of its own).
//
// Source-size check (marked): it counts lines the same way scripts/check-file-size.mjs does, on the
// real file. It reads no behaviour from the source text.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const LIMIT = 1000
const lineCount = (text: string) => (text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0))

describe('CR-02 · terminal.service.ts stays within the file-size limit', () => {
  it('CR-02 · electron/main/services/terminal.service.ts has at most 1000 lines', () => {
    const text = readFileSync(join(process.cwd(), 'electron', 'main', 'services', 'terminal.service.ts'), 'utf8')
    expect(lineCount(text)).toBeLessThanOrEqual(LIMIT)
  })
})
