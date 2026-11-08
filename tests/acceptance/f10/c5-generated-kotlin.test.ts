// Frozen acceptance test for 1.5.0 F10, BACKEND's C5 tasks BE-A45-flag and BE-A46-c5: the phone's protocol module is
// regenerated from shared/remote/protocol.ts (`npm run android:generate`) and committed, with the new fields optional and
// no new enum (the #531 rule). That the committed file is current is tests/android-generated.test.ts (in verify). Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f10-c5-backend.md.
// rigor: source-assertion — the criterion is the generated file itself (what the committed Kotlin declares), which the
// phone's JVM tests consume; no TypeScript call can show it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = process.cwd()
const KOTLIN = 'mobile/android/protocol/src/main/kotlin/com/oxespace/mobile/protocol/RemoteProtocol.kt'
const kotlin = (): string => readFileSync(join(ROOT, KOTLIN), 'utf8')
/** The body of one generated data class, up to its closing parenthesis line. */
function dataClass(name: string): string {
  const text = kotlin()
  const start = text.indexOf(`data class ${name}(`)
  if (start < 0) throw new Error(`no data class ${name}`)
  return text.slice(start, text.indexOf('\n)', start))
}

describe('F10 · the generated Kotlin carries the C5 fields', () => {
  test('BE-A45: RemoteSubscribeFrame has an optional snapshotOnly flag', () => {
    expect(dataClass('RemoteSubscribeFrame')).toMatch(/val snapshotOnly: Boolean\? = null/)
  })

  test('BE-A46: RemotePane has an optional conversation flag, and the page type is generated', () => {
    expect(dataClass('RemotePane')).toMatch(/val conversation: Boolean\? = null/)
    const page = dataClass('RemotePaneConversationPage')
    for (const field of ['agent: String', 'items:', 'cursor: String?', 'epoch:']) expect(page).toContain(field)
    expect(dataClass('RemotePaneConversationArgs')).toMatch(/val paneId: String/)
  })

  test('F10: no new enum: the error codes, the reason and the agent stay text', () => {
    // Nine enums were generated on main before F10 (08/11).
    expect(kotlin().match(/\benum class\b/g)).toHaveLength(9)
    expect(dataClass('RemoteErrorFrame')).toMatch(/val reason: String\? = null/)
  })
})
