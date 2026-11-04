// @xterm/headless and the serialize addon are CommonJS: the main bundle is ESM, so only their default exports import.
import xtermHeadless from '@xterm/headless'
import xtermSerialize from '@xterm/addon-serialize'
import type { RemoteTerminalSnapshot } from '../../../../shared/remote/protocol'
import { redactCounted, scrubPaths } from './text'

/** Rows of history kept above the screen (TECH LEAD, 1.4.3 P4). */
export const SNAPSHOT_SCROLLBACK = 200
/** History tried in turn when the snapshot does not fit its frame (TECH LEAD on #634). */
export const SCROLLBACK_STEPS = [SNAPSHOT_SCROLLBACK, 50, 0] as const
const MAX_COLS = 500
const MAX_ROWS = 200

/**
 * 1.4.3 P4 · The pane's screen for a phone that just subscribed, so it does not start from an empty grid.
 *
 * Built once per subscription from the text the topic already releases to the phone: redacted, its paths scrubbed,
 * and cut so no secret, path or escape sequence is split (`TerminalWindow`). A short-lived headless emulator replays
 * it at the pane's size (scrollback capped) and xterm's own serializer writes the result (scrollback, then the screen,
 * the modes and the cursor). The emulator is disposed at once; nothing is kept per pane.
 *
 * Second layer: the rendered text is redacted again. A secret printed in two colours reaches the emulator split by an
 * escape sequence, so the raw-text redactor never saw it whole; on screen it reads as one. When that check finds
 * anything, the snapshot falls back to the redacted plain rows (colours lost, the secret never shown).
 */
export async function buildTerminalSnapshot(
  text: string, cols: number, rows: number, roots: readonly string[], fits: (snapshot: RemoteTerminalSnapshot) => boolean = () => true
): Promise<{ snapshot: RemoteTerminalSnapshot; redacted: number } | null> {
  const width = clamp(cols, 20, MAX_COLS, 80), height = clamp(rows, 5, MAX_ROWS, 24)
  const terminal = new xtermHeadless.Terminal({ cols: width, rows: height, scrollback: SNAPSHOT_SCROLLBACK, allowProposedApi: true })
  try {
    const serializer = new xtermSerialize.SerializeAddon()
    terminal.loadAddon(serializer as never)
    await new Promise<void>(resolve => terminal.write(text, () => resolve()))
    const buffer = terminal.buffer.active
    // The rendered text, wrapped rows joined so a secret broken by the wrap is whole again.
    const lines: string[] = []
    for (let index = 0; index < buffer.length; index += 1) {
      const line = buffer.getLine(index)
      if (!line) continue
      const textOfLine = line.translateToString(true)
      if (line.isWrapped && lines.length) lines[lines.length - 1] += textOfLine
      else lines.push(textOfLine)
    }
    const rendered = lines.join('\n')
    const checked = redactCounted(scrubPaths(rendered, roots))
    const styled = !checked.redacted && checked.text === rendered
    // Fallback rows: the redacted plain text, the cursor placed where it was, colours dropped.
    const plainRows = checked.text.split('\n')
    const cursor = `\x1b[${buffer.cursorY + 1};${buffer.cursorX + 1}H`
    // TECH LEAD on #634: a busy pane must keep its screen. Too big for its frame: less history (200, 50, then none);
    // left out only when the screen alone does not fit.
    for (const keep of SCROLLBACK_STEPS) {
      const ansi = styled
        ? serializer.serialize({ scrollback: keep })
        : `${plainRows.slice(Math.max(0, plainRows.length - height - keep)).join('\r\n')}${cursor}`
      const snapshot = { ansi, cols: width, rows: height }
      if (fits(snapshot)) return { snapshot, redacted: styled ? 0 : checked.redacted }
    }
    return null
  } finally {
    terminal.dispose()
  }
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback
}
