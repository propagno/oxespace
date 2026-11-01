import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as protocol from '../shared/remote/protocol'
// @ts-expect-error plain ESM script without types
import { constantName, PROTOCOL_KOTLIN_PATH, protocolKotlin } from '../scripts/android/protocol-kotlin.mjs'
// @ts-expect-error plain ESM script without types
import { phoneCatalog, resourceName, STRINGS_XML_PATHS, stringsXml } from '../scripts/android/strings-xml.mjs'
// @ts-expect-error plain ESM script without types
import { camelName, kotlinColor, THEME_KOTLIN_PATH, themeKotlin } from '../scripts/android/theme-kotlin.mjs'
import { IDENTITY } from '../src/design/tokens/palette'
import { LEADING, MOTION, RADIUS, REDUCED_MOTION, SPACE, TEXT, WEIGHT } from '../src/design/tokens/scales'
import { colorRoles } from '../src/design/tokens/semantic'

const root = join(__dirname, '..')
const protocolSource = readFileSync(join(root, 'shared', 'remote', 'protocol.ts'), 'utf8')
const tokens = { colorRoles, IDENTITY, SPACE, RADIUS, TEXT, WEIGHT, LEADING, MOTION, REDUCED_MOTION }
const committed = (path: string): string => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')
const readCatalog = (language: string, namespace: string) => JSON.parse(readFileSync(join(root, 'shared', 'locales', language, `${namespace}.json`), 'utf8'))
const catalog = (language: string): Record<string, unknown> => phoneCatalog(readCatalog, language)

describe('Android sources generated from the contracts', () => {
  it('match the committed Kotlin of the C5 protocol (run npm run android:generate after a contract change)', () => {
    expect(committed(PROTOCOL_KOTLIN_PATH)).toBe(protocolKotlin(protocolSource, protocol))
  })

  it('match the committed Kotlin tokens (run npm run android:generate after editing a token)', () => {
    expect(committed(THEME_KOTLIN_PATH)).toBe(themeKotlin(tokens))
  })

  it('take the agent state words from common.json only (glossary §5)', () => {
    expect(() => phoneCatalog((_l: string, ns: string) => (ns === 'mobile' ? { agents: { state: { idle: 'x' } } } : { agents: { state: {} } }), 'en')).toThrow(/agents\.state/)
    expect((catalog('pt-BR') as { agents: { state: Record<string, string> } }).agents.state.idle).toBe('Ocioso')
  })

  it('match the committed string resources (run npm run android:generate after editing mobile.json)', () => {
    for (const [language, path] of Object.entries(STRINGS_XML_PATHS as Record<string, string>)) {
      expect(committed(path), language).toBe(stringsXml(catalog('en'), catalog(language), language))
    }
  })

  it('carries every frame, command, subscription and error code to Kotlin', () => {
    const kotlin: string = protocolKotlin(protocolSource, protocol)
    for (const type of protocol.REMOTE_FRAME_TYPES) expect(kotlin).toContain(`@SerialName("${type}")\ndata class`)
    for (const wire of [...protocol.REMOTE_COMMANDS, ...protocol.REMOTE_SUBSCRIPTIONS, ...protocol.REMOTE_ERROR_CODES]) {
      expect(kotlin).toContain(`@SerialName("${wire}") ${constantName(wire)}("${wire}")`)
    }
    expect(kotlin).toContain(`const val MAX_FRAME_BYTES: Int = ${protocol.REMOTE_LIMITS.maxFrameBytes}`)
  })

  it('keeps the forbidden capabilities out of every Kotlin enum', () => {
    const kotlin: string = protocolKotlin(protocolSource, protocol)
    for (const forbidden of protocol.REMOTE_FORBIDDEN) expect(kotlin).not.toContain(`@SerialName("${forbidden}")`)
  })

  it('fails on a field type it has no mapping for, instead of dropping the field', () => {
    const changed = protocolSource.replace('desktopName?: string', 'desktopName?: Date')
    expect(() => protocolKotlin(changed, protocol)).toThrow(/no Kotlin mapping for `Date` in RemoteHelloFrame.desktopName/)
  })

  it('names enum entries after their wire value', () => {
    expect(constantName('thread.respondRequest')).toBe('THREAD_RESPOND_REQUEST')
    expect(constantName('too-many-subscriptions')).toBe('TOO_MANY_SUBSCRIPTIONS')
    expect(constantName('pendingRequests')).toBe('PENDING_REQUESTS')
    expect(constantName('maxFrameBytes')).toBe('MAX_FRAME_BYTES')
  })

  it('maps the payload shapes of M4/M5: tagged unions, extends, nullable, word sets, maps and nested arrays', () => {
    const shapes = `
export const REMOTE_TEXT_LIMITS = { itemText: 8_000 } as const
export interface RemoteSummary { id: string; status: 'idle' | 'running' }
export interface RemoteHeader extends RemoteSummary { queued: number }
export interface RemoteJob { exitCode: number | null; steps: { label: string }[]; answers?: Record<string, string[]> }
/** One item. */
export type RemoteItem =
  /** Said by someone. */
  | { type: 'message'; id: string; text: string }
  | { type: 'request-resolved'; id: string; header: RemoteHeader }`
    const kotlin: string = protocolKotlin(protocolSource + shapes, { ...protocol, REMOTE_TEXT_LIMITS: { itemText: 8_000 } })
    expect(kotlin).toContain('object RemoteTextLimits {\n    const val ITEM_TEXT: Int = 8000\n}')
    // A set of words is a String, so a value a newer desktop adds still reads.
    expect(kotlin).toContain('data class RemoteSummary(\n    val id: String,\n    val status: String,\n)')
    expect(kotlin).toContain('data class RemoteHeader(\n    val id: String,\n    val status: String,\n    val queued: Long,\n)')
    expect(kotlin).toContain('    val exitCode: Long?,\n    val steps: List<Step>,\n    val answers: Map<String, List<String>>? = null,')
    expect(kotlin).toContain('    @Serializable\n    data class Step(\n        val label: String,\n    )')
    expect(kotlin).toContain('/** One item. */\n@Serializable\nsealed interface RemoteItem {')
    expect(kotlin).toContain('    /** Said by someone. */\n    @Serializable\n    @SerialName("message")\n    data class Message(\n        val id: String,\n        val text: String,\n    ) : RemoteItem')
    expect(kotlin).toContain('    @SerialName("request-resolved")\n    data class RequestResolved(\n        val id: String,\n        val header: RemoteHeader,\n    ) : RemoteItem')
  })

  it('carries every color role of both modes to Kotlin', () => {
    const kotlin: string = themeKotlin(tokens)
    for (const mode of ['light', 'dark'] as const) {
      for (const [role, value] of Object.entries(colorRoles(mode))) expect(kotlin).toContain(`${camelName(role)} = ${kotlinColor(value)},`)
    }
  })

  it('converts colors, including the translucent scrim', () => {
    expect(kotlinColor('#1f6b4a')).toBe('Color(0xFF1F6B4A)')
    expect(kotlinColor('rgba(18, 28, 22, 0.32)')).toBe('Color(0x52121C16)')
    expect(() => kotlinColor('oklch(0.5 0.1 150)')).toThrow(/no Kotlin color/)
  })

  it('turns catalog text into aapt-safe strings with the same arguments in every language', () => {
    const english = { share: { title: "Can't reach {{desktop}} at {{address}}", note: '@home 100% <ok> "quoted"' }, devices_one: '{{count}} device on {{desktop}}', devices_other: '{{count}} devices on {{desktop}}' }
    const portuguese = { share: { title: 'Sem acesso a {{address}} ({{desktop}})', note: '@casa 100% <ok> "citado"' }, devices_one: '{{count}} aparelho em {{desktop}}', devices_other: '{{count}} aparelhos em {{desktop}}' }
    const en: string = stringsXml(english, english, 'en')
    expect(en).toContain(String.raw`<string name="share_title">Can\'t reach %1$s at %2$s</string>`)
    expect(en).toContain(String.raw`<string name="share_note">\@home 100% &lt;ok&gt; \"quoted\"</string>`)
    expect(en).toContain('<item quantity="one">%2$d device on %1$s</item>')
    // Portuguese reorders the words, not the arguments.
    expect(stringsXml(english, portuguese, 'pt-BR')).toContain('<string name="share_title">Sem acesso a %2$s (%1$s)</string>')
    expect(resourceName('pairing.codeExpired')).toBe('pairing_code_expired')
  })

  it('refuses a translation that uses a placeholder English does not have', () => {
    expect(() => stringsXml({ title: 'Hi {{name}}' }, { title: 'Oi {{nome}}' }, 'pt-BR')).toThrow(/mobile:title uses \{\{nome\}\}/)
  })
})
