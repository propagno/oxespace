import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSeenHosts, linkHost, linkPrompt, MAX_EXTERNAL_URL_LENGTH, openExternalLink, parseExternalUrl, SEEN_HOSTS_KEY, seenHosts, textIsAddress, textMisleads } from '../src/lib/externalLinks'
import { decodePunycodeLabel, toUnicodeHost } from '../src/lib/punycode'
import { splitAtHost } from '../src/components/ExternalLinks/ExternalLinkDialog'
import { onTerminalLink } from '../src/components/Terminal/terminalLinks'
import { SeenSitesSetting } from '../src/components/Settings/SeenSitesSetting'
import { MarkdownPreview } from '../src/components/Preview/MarkdownPreview'

let open: ReturnType<typeof vi.spyOn>
beforeEach(() => { localStorage.clear(); open = vi.spyOn(window, 'open').mockImplementation(() => null) })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await new Promise(resolve => setTimeout(resolve, 0)) })

const dialog = (): Promise<HTMLElement> => screen.findByTestId('external-link-dialog')

describe('URL rules', () => {
  it('lets http, https and mailto through', () => {
    expect(parseExternalUrl('https://github.com/a')?.href).toBe('https://github.com/a')
    expect(parseExternalUrl(' http://example.com ')?.hostname).toBe('example.com')
    expect(parseExternalUrl('mailto:dev@example.org')?.protocol).toBe('mailto:')
  })
  it('refuses other schemes, credentials, relative and over-long URLs', () => {
    for (const bad of ['javascript:alert(1)', 'file:///C:/x', 'data:text/html,hi', 'vscode://x', 'oxespace://x', '/relative', 'not a url', '',
      'https://user:pass@example.com', 'https://user@example.com', `https://example.com/${'a'.repeat(MAX_EXTERNAL_URL_LENGTH)}`]) {
      expect(parseExternalUrl(bad), bad).toBeNull()
    }
    expect(parseExternalUrl(`https://e.com/${'a'.repeat(MAX_EXTERNAL_URL_LENGTH - 'https://e.com/'.length)}`)).not.toBeNull()
  })
  it('reads the host of web and mail links in lower case', () => {
    expect(linkHost(new URL('https://GitHub.com/x'))).toBe('github.com')
    expect(linkHost(new URL('mailto:Dev@Example.ORG?subject=hi'))).toBe('example.org')
  })
  it('refuses with a message and never opens', async () => {
    expect(await openExternalLink('javascript:alert(1)', { source: 'app' })).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(await openExternalLink('file:///etc/passwd', { source: 'markdown' })).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})

describe('misleading text', () => {
  const url = new URL('https://evil.example/login')
  it('the address itself or its host is not misleading', () => {
    expect(textMisleads(url, 'https://evil.example/login')).toBe(false)
    expect(textMisleads(url, 'evil.example/login/')).toBe(false)
    expect(textMisleads(url, 'evil.example')).toBe(false)
    expect(textMisleads(url, 'www.evil.example')).toBe(false)
    expect(textMisleads(url, 'https://evil.example/other')).toBe(false)
    expect(textMisleads(url, undefined)).toBe(false)
  })
  it('text that names another link or host is', () => {
    expect(textMisleads(url, 'https://github.com/login')).toBe(true)
    expect(textMisleads(url, 'github.com')).toBe(true)
    expect(textMisleads(url, 'Sign in at github.com/login')).toBe(true)
    expect(textMisleads(url, 'me@github.com')).toBe(true)
  })
  it('words, the right host in a sentence and file names are not', () => {
    expect(textMisleads(url, 'the PR')).toBe(false)
    expect(textMisleads(url, 'Docs')).toBe(false)
    expect(textMisleads(url, 'Sign in to evil.example')).toBe(false)
    expect(textMisleads(url, 'notes.md')).toBe(false)
    expect(textMisleads(url, 'https://notes.md/x')).toBe(true)
  })
  it('only the address or its host counts as text that says where it goes', () => {
    expect(textIsAddress(url, 'evil.example')).toBe(true)
    expect(textIsAddress(url, 'https://www.evil.example/login')).toBe(true)
    expect(textIsAddress(url, 'the PR')).toBe(false)
    expect(textIsAddress(url, 'see evil.example')).toBe(false)
  })
  it('a word link to a host already opened goes straight through: no warning', () => {
    expect(linkPrompt(url, { source: 'markdown', text: 'the PR' }, ['evil.example'])).toBeNull()
    expect(linkPrompt(url, { source: 'markdown', text: 'the PR' }, [])).not.toHaveProperty('text')
  })
})

describe('punycode', () => {
  it('decodes IDN labels and leaves ASCII alone', () => {
    expect(decodePunycodeLabel('mnchen-3ya')).toBe('münchen')
    expect(toUnicodeHost('xn--mnchen-3ya.de')).toBe('münchen.de')
    expect(toUnicodeHost('github.com')).toBe('github.com')
    expect(toUnicodeHost('xn--80ak6aa92e.com')).toBe('аррӏе.com')
    expect(toUnicodeHost('xn--!!.com')).toBe('xn--!!.com')
  })
  it('the prompt carries both forms when they differ', () => {
    const prompt = linkPrompt(parseExternalUrl('https://аррӏе.com/')!, { source: 'markdown' }, [])
    expect(prompt).toMatchObject({ host: 'xn--80ak6aa92e.com', unicodeHost: 'аррӏе.com' })
    expect(linkPrompt(parseExternalUrl('https://github.com/')!, { source: 'markdown' }, [])).not.toHaveProperty('unicodeHost')
  })
  it('the dialog marks the host inside the full address', () => {
    expect(splitAtHost('https://github.com.evil.example/a?b', 'github.com.evil.example')).toEqual(['https://', 'github.com.evil.example', '/a?b'])
    expect(splitAtHost('mailto:a@example.org', 'example.org')).toEqual(['mailto:a@', 'example.org', ''])
  })
})

describe('confirmation and remembered hosts', () => {
  it('asks for a new host; Cancel opens nothing and remembers nothing', async () => {
    const pending = openExternalLink('https://example.com/a', { source: 'github' })
    const shown = await dialog()
    expect(screen.getByTestId('external-link-host')).toHaveTextContent('example.com')
    expect(screen.getByTestId('external-link-url')).toHaveTextContent('https://example.com/a')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(shown).not.toHaveTextContent('Link text')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await pending).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(seenHosts()).toEqual([])
  })
  it('Open opens, remembers the host, and the next link to it goes straight through', async () => {
    const first = openExternalLink('https://example.com/a', { source: 'linear' })
    await dialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await first).toBe(true)
    expect(open).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer')
    expect(JSON.parse(localStorage.getItem(SEEN_HOSTS_KEY)!)).toEqual(['example.com'])
    await waitFor(() => expect(screen.queryByTestId('external-link-dialog')).toBeNull())
    expect(await openExternalLink('https://example.com/b', { source: 'linear' })).toBe(true)
    expect(open).toHaveBeenCalledTimes(2)
  })
  it('misleading text asks even for a remembered host, and shows the text', async () => {
    localStorage.setItem(SEEN_HOSTS_KEY, JSON.stringify(['evil.example']))
    const pending = openExternalLink('https://evil.example/x', { source: 'markdown', text: 'github.com' })
    await dialog()
    expect(screen.getByTestId('external-link-text')).toHaveTextContent('github.com')
    expect(screen.getByTestId('external-link-host')).toHaveTextContent('evil.example')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await pending).toBe(false)
  })
  it("source 'app' skips the question, still validates, and is not remembered", async () => {
    expect(await openExternalLink('https://github.com/propagno/oxespace', { source: 'app' })).toBe(true)
    expect(open).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('external-link-dialog')).toBeNull()
    expect(seenHosts()).toEqual([])
    expect(await openExternalLink('https://u:p@github.com/', { source: 'app' })).toBe(false)
  })
  it("source 'preview' asks like any other outside link", () => {
    expect(linkPrompt(parseExternalUrl('http://localhost:5173/')!, { source: 'preview' }, [])).toMatchObject({ host: 'localhost', source: 'preview' })
    expect(linkPrompt(parseExternalUrl('http://localhost:5173/')!, { source: 'preview' }, ['localhost'])).toBeNull()
  })
  it('survives storage that throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(seenHosts()).toEqual([])
    const pending = openExternalLink('https://example.com', { source: 'markdown' })
    await dialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await pending).toBe(true)
  })
})

describe('terminal links', () => {
  it('a plain click selects text; Ctrl or Cmd+click asks to open', async () => {
    onTerminalLink(new MouseEvent('click'), 'https://example.com/t')
    await Promise.resolve()
    expect(screen.queryByTestId('external-link-dialog')).toBeNull()
    onTerminalLink(new MouseEvent('click', { ctrlKey: true }), 'https://example.com/t')
    await dialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.com/t', '_blank', 'noopener,noreferrer'))
  })
})

describe('markdown and settings', () => {
  it('file markdown shows the real host after misleading text and never navigates other schemes', async () => {
    render(<MarkdownPreview content={'[github.com](https://evil.example/x) [evil.example](https://evil.example/) [local](./README.md) [the PR](https://evil.example/pr)'} />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(3)
    expect(links[2]).toHaveTextContent('the PR (evil.example)')
    expect(links[0]).toHaveTextContent('github.com (evil.example)')
    expect(links[1].querySelector('[data-testid="external-link-suffix"]')).toBeNull()
    fireEvent.click(links[0])
    await dialog()
    expect(screen.getByTestId('external-link-host')).toHaveTextContent('evil.example')
  })
  it('Settings › General › Privacy shows the count and clears it', () => {
    localStorage.setItem(SEEN_HOSTS_KEY, JSON.stringify(['a.example', 'b.example']))
    render(<SeenSitesSetting />)
    expect(screen.getByTestId('seen-sites-count')).toHaveTextContent('2 sites remembered.')
    fireEvent.click(screen.getByRole('button', { name: "Clear sites you've opened" }))
    expect(screen.getByTestId('seen-sites-count')).toHaveTextContent('0 sites remembered.')
    expect(seenHosts()).toEqual([])
    expect(screen.getByRole('button', { name: "Clear sites you've opened" })).toBeDisabled()
    act(() => { localStorage.setItem(SEEN_HOSTS_KEY, JSON.stringify(['c.example'])); clearSeenHosts() })
  })
})

describe('one way out', () => {
  it('no renderer file opens a window or a blank-target anchor except through openExternalLink', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const files: string[] = []
    const walk = (dir: string): void => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.tsx?$/.test(name)) files.push(path) } }
    walk('src')
    const allowed = new Set([join('src', 'lib', 'externalLinks.ts'), join('src', 'components', 'ExternalLinks', 'ExternalAnchor.tsx')])
    const offenders = files.filter(file => !allowed.has(file) && /window\.open\(|<a\b[^>]*target=["']_blank["']/.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
