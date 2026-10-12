import { describe, expect, it } from 'vitest'
import { JsonLinesDecoder } from '../electron/main/services/conversation/json-lines'

describe('conversation protocol framing', () => {
  it('handles split UTF-8, CRLF, blank lines and a final object', () => {
    const values: unknown[] = []
    const decoder = new JsonLinesDecoder(value => values.push(value))
    const bytes = Buffer.from('{"text":"decisão 😀"}\r\n\n{"id":2}')
    for (const byte of bytes) decoder.push(Uint8Array.of(byte))
    decoder.finish()
    expect(values).toEqual([{ text: 'decisão 😀' }, { id: 2 }])
  })
  it('accepts batches whose individual frames fit the budget', () => {
    const values: unknown[] = []
    const decoder = new JsonLinesDecoder(value => values.push(value), 8)
    decoder.push(Buffer.from('{"a":1}\n{"b":2}\n'))
    expect(values).toHaveLength(2)
  })
  it('fails closed on malformed frames without leaking their content', () => {
    const decoder = new JsonLinesDecoder(() => {})
    expect(() => decoder.push(Buffer.from('private-token\n'))).toThrow('Invalid JSON in agent protocol stream')
    expect(() => decoder.push(Buffer.from('{}\n'))).toThrow('closed')
  })
  it('rejects oversized unfinished and completed frames', () => {
    expect(() => new JsonLinesDecoder(() => {}, 8).push(Buffer.from('{"text":"long"}'))).toThrow('size limit')
    expect(() => new JsonLinesDecoder(() => {}, 8).push(Buffer.from('{"text":"long"}\n'))).toThrow('size limit')
  })
  it('rejects scalar messages and incomplete UTF-8', () => {
    expect(() => new JsonLinesDecoder(() => {}).push(Buffer.from('null\n'))).toThrow('protocol object')
    const decoder = new JsonLinesDecoder(() => {})
    decoder.push(Uint8Array.of(0xf0))
    expect(() => decoder.finish()).toThrow()
  })
})
