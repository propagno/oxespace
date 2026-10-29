import type { ReactElement } from 'react'

/**
 * A translation whose only markup is <strong>…</strong>, e.g. "Only for terminals you are <strong>not watching</strong>."
 * react-i18next's Trans does the same for any markup, but brings an HTML parser into the boot bundle.
 */
export function RichText({ text }: { text: string }): ReactElement {
  return <>{text.split(/<strong>(.*?)<\/strong>/g).map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : part)}</>
}
