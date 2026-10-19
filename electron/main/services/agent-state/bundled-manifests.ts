// herdr's detection manifests (Apache-2.0, see resources/agent-detection/LICENSE-APACHE-2.0 and NOTICE),
// embedded in the main bundle so packaging needs no extra resource.
import amp from '../../../../resources/agent-detection/amp.toml?raw'
import claude from '../../../../resources/agent-detection/claude.toml?raw'
import codex from '../../../../resources/agent-detection/codex.toml?raw'
import cursor from '../../../../resources/agent-detection/cursor.toml?raw'
import droid from '../../../../resources/agent-detection/droid.toml?raw'
import gemini from '../../../../resources/agent-detection/gemini.toml?raw'
import github_copilot from '../../../../resources/agent-detection/github-copilot.toml?raw'
import grok from '../../../../resources/agent-detection/grok.toml?raw'
import kimi from '../../../../resources/agent-detection/kimi.toml?raw'
import opencode from '../../../../resources/agent-detection/opencode.toml?raw'
import qwen from '../../../../resources/agent-detection/qwen.toml?raw'

export const BUNDLED_MANIFESTS: Array<{ file: string; text: string }> = [
  { file: 'amp.toml', text: amp },
  { file: 'claude.toml', text: claude },
  { file: 'codex.toml', text: codex },
  { file: 'cursor.toml', text: cursor },
  { file: 'droid.toml', text: droid },
  { file: 'gemini.toml', text: gemini },
  { file: 'github-copilot.toml', text: github_copilot },
  { file: 'grok.toml', text: grok },
  { file: 'kimi.toml', text: kimi },
  { file: 'opencode.toml', text: opencode },
  { file: 'qwen.toml', text: qwen },
]
