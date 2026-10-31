/**
 * "Report a problem" (Help menu): the GitHub issue the person reviews before anything leaves the app.
 * The text is built locally and shown in a preview; it reaches GitHub only when the person clicks to open
 * the issue page or copies it themselves. Nothing is sent by the app.
 */
export const ISSUE_NEW_URL = 'https://github.com/propagno/oxespace/issues/new'

/**
 * Most browsers and GitHub accept links up to roughly 8,000 characters. The body keeps well under that after
 * percent-encoding; a longer body is cut for the link only, and the preview offers Copy for the whole text.
 */
export const ISSUE_URL_MAX = 7000

export interface IssueDraft {
  title: string
  body: string
}

/** What the main process hands to the preview. Already redacted. */
export interface IssueReport extends IssueDraft {
  /** How the diagnostics section was built, so the preview can say what is in it. */
  diagnosticLines: number
}

export interface IssueLink {
  url: string
  /** The body did not fit in a link and was shortened. */
  truncated: boolean
}

const CUT_NOTICE = '\n\n[…text cut to fit the link; the full report was copied or is in the preview]'

export function buildIssueUrl(draft: IssueDraft): IssueLink {
  const link = (body: string): string => `${ISSUE_NEW_URL}?title=${encodeURIComponent(draft.title)}&body=${encodeURIComponent(body)}`
  let url = link(draft.body)
  if (url.length <= ISSUE_URL_MAX) return { url, truncated: false }
  // Cut by characters, then re-check: percent-encoding makes the length depend on the text.
  let body = draft.body
  while (url.length > ISSUE_URL_MAX && body.length > 0) {
    const excess = url.length - ISSUE_URL_MAX
    body = body.slice(0, Math.max(0, body.length - Math.max(32, Math.ceil(excess / 3))))
    // A cut between the halves of an emoji would make encodeURIComponent throw.
    if (/[\uD800-\uDBFF]$/.test(body)) body = body.slice(0, -1)
    url = link(body + CUT_NOTICE)
  }
  return { url, truncated: true }
}

/** The text a person pastes into an issue by hand. */
export function issueClipboardText(draft: IssueDraft): string {
  return `${draft.title}\n\n${draft.body}`
}
