import { describe, expect, it } from 'vitest'
import { formatNativeUserText } from '../shared/native-session-text'

describe('native session text', () => {
  it('hides generated environment metadata and local image paths while keeping the user request', () => {
    const text = '<environment_context>\n  <current_date>2026-09-24</current_date>\n  <filesystem><root>C:\\private\\repo</root></filesystem>\n</environment_context>\n\n<image name=[Image #1] path="C:\\private\\capture.png"> </image>\nAjuste o layout.'
    expect(formatNativeUserText(text)).toBe('[Image #1 attached]\nAjuste o layout.')
    expect(formatNativeUserText('<environment_context><current_date>2026-09-24</current_date></environment_context>')).toBe('')
    expect(formatNativeUserText('<environment_context><cwd>C:\\private\\repo</cwd><shell>powershell</shell></environment_context>')).toBe('')
  })
  it('preserves ordinary text and markup that is not generated session metadata', () => {
    const text = 'Documente `<environment_context>` no README.'
    expect(formatNativeUserText(text)).toBe(text)
  })
})
