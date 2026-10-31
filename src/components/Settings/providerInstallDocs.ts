import type { AgentProvider } from '../../../shared/types/agent'
import { i18n } from '../../i18n'

/** An official install or docs page for a built-in agent CLI (opened externally). */
export interface ProviderInstallDoc {
  product: string
  /** How the link is labelled: "Install X", "X docs", or the product name alone. */
  kind: 'install' | 'docs' | 'name'
  url: string
}

export const PROVIDER_INSTALL_DOCS: Partial<Record<AgentProvider, ProviderInstallDoc>> = {
  claude: { product: 'Claude Code', kind: 'install', url: 'https://docs.anthropic.com/en/docs/claude-code/overview' },
  copilot: { product: 'Copilot CLI', kind: 'install', url: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli' },
  codex: { product: 'Codex CLI', kind: 'install', url: 'https://github.com/openai/codex' },
  cursor: { product: 'Cursor CLI', kind: 'docs', url: 'https://cursor.com/docs' },
  antigravity: { product: 'Antigravity (agy)', kind: 'name', url: 'https://github.com/search?q=antigravity+cli+agy&type=repositories' },
  grok: { product: 'Grok CLI', kind: 'docs', url: 'https://docs.x.ai/' }
}

export function installDocLabel(doc: ProviderInstallDoc): string {
  return doc.kind === 'name' ? doc.product : i18n.t(`settings:providers.installDoc.${doc.kind}`, { product: doc.product })
}
