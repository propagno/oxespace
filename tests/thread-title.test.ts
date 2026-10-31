import { afterEach, describe, expect, it } from 'vitest'
import { displayThreadTitle, namedThreadTitle } from '../src/components/Threads/threadTitle'
import { changeLanguage } from '../src/i18n'

afterEach(async () => { await changeLanguage('en') })

describe('conversation titles', () => {
  it('an unnamed conversation (empty, or the English sentinel main used to store) reads "New conversation"', async () => {
    for (const title of ['', '  ', null, undefined, 'New thread', ' New thread ']) expect(displayThreadTitle(title), String(title)).toBe('New conversation')
    await changeLanguage('pt-BR')
    expect(displayThreadTitle('New thread')).toBe('Nova conversa')
    expect(displayThreadTitle('')).toBe('Nova conversa')
  })
  it('a named one keeps its name, trimmed, in every language', async () => {
    expect(displayThreadTitle(' Fix the login bug ')).toBe('Fix the login bug')
    await changeLanguage('pt-BR')
    expect(displayThreadTitle('Fix the login bug')).toBe('Fix the login bug')
    // Only the exact sentinel is unnamed: a title that mentions it is a real name.
    expect(displayThreadTitle('New thread for the API')).toBe('New thread for the API')
  })
  it('a rename starts empty for an unnamed conversation and from the name otherwise', () => {
    expect(namedThreadTitle('New thread')).toBe('')
    expect(namedThreadTitle('')).toBe('')
    expect(namedThreadTitle(' Release notes ')).toBe('Release notes')
  })
})
