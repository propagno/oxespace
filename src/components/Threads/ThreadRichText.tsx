import type { ReactElement } from 'react'

/**
 * A translation whose only markup is <code>…</code> or <strong>…</strong>, e.g. "plans them with <code>oxespace_work_plan</code>".
 * Like src/i18n/RichText (Settings), without bringing Trans and its HTML parser into the bundle; any other tag stays text.
 */
export function ThreadRichText({ text }: { text: string }): ReactElement {
  return <>{text.split(/<(code|strong)>(.*?)<\/\1>/g).map((part, index, parts) => {
    if (index % 3 === 1) return null
    if (index % 3 === 2) return parts[index - 1] === 'code' ? <code key={index}>{part}</code> : <strong key={index}>{part}</strong>
    return part
  })}</>
}
