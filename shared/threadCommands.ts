import type { ThreadCommand } from './types/thread'

/** Stable operations stay in the conversation; interactive commands use the real CLI.
 * Availability of platform/plan/experimental commands is decided by that CLI. */
export const CODEX_THREAD_COMMANDS: ThreadCommand[] = [
  { name: 'compact', description: 'Summarize conversation context', source: 'codex' },
  { name: 'model', description: 'Show models or choose the model and reasoning effort', argumentHint: '[model] [effort]', source: 'codex' },
  { name: 'review', description: 'Review uncommitted changes or give custom review instructions', argumentHint: '[instructions]', source: 'codex' },
  { name: 'status', description: 'Show the current native conversation configuration', source: 'codex' }
]

const codexInteractive: [string, string][] = [
  ['permissions', 'Adjust access and approval rules'], ['approvals', 'Open access settings on older CLI releases'],
  ['model', 'Select a model and effort'], ['fast', 'Configure the fast service tier'], ['personality', 'Select a response style'],
  ['plan', 'Enter planning mode'], ['goal', 'Manage the current task goal'], ['skills', 'Browse available skills'],
  ['apps', 'Browse connected apps'], ['plugins', 'Manage plugins'], ['hooks', 'Manage lifecycle hooks'],
  ['mcp', 'Inspect connected MCP servers'], ['new', 'Start a new conversation with the same settings'], ['clear', 'Start a new conversation with the same settings'],
  ['resume', 'Choose a saved native conversation'], ['fork', 'Branch this native conversation'], ['rename', 'Rename this conversation'],
  ['archive', 'Archive this conversation'], ['delete', 'Delete this conversation from OXESpace; the provider session is kept'],
  ['review', 'Choose a review target'], ['diff', 'Inspect project changes'], ['copy', 'Show the last response to copy'], ['export', 'Show this conversation as Markdown to copy'],
  ['mention', 'Choose a file for the next message'], ['status', 'Inspect configuration and usage'], ['usage', 'Inspect subscription limits'],
  ['debug-config', 'Inspect configuration sources'], ['experimental', 'Manage experimental options'], ['memories', 'Configure native memory'],
  ['import', 'Import supported agent setup'], ['init', 'Create project instructions'], ['feedback', 'Open the native feedback form'],
  ['logout', 'Open agent accounts to sign out'], ['quit', 'Stop the agent process; your next message starts it again'], ['exit', 'Stop the agent process; your next message starts it again'],
  ['ps', 'Inspect background processes'], ['stop', 'Interrupt the current turn'], ['approve', 'Retry a denied action through native approval'],
  ['agent', 'Choose an agent conversation'], ['agents', 'Inspect agent conversations'], ['subagents', 'Choose a subagent conversation'],
  ['side', 'Open a temporary side conversation'], ['btw', 'Open a temporary side conversation'], ['worktree', 'Manage native worktree conversations'],
  ['app', 'Continue in the provider desktop app'], ['ide', 'Configure IDE context'], ['keymap', 'Configure native keyboard shortcuts'], ['vim', 'Configure native input editing'],
  ['raw', 'Configure native transcript rendering'], ['theme', 'Configure CLI highlighting'], ['title', 'Configure the terminal title'], ['statusline', 'Configure native status information'],
  ['pet', 'Configure the native pet'], ['pets', 'Configure the native pet'], ['voice', 'Configure native voice input'],
  ['setup-default-sandbox', 'Configure the Windows sandbox'], ['sandbox-add-read-dir', 'Add a native sandbox read directory'],
  ['daemon', 'Manage the native background server'], ['cd', 'Change the native CLI directory'], ['pwd', 'Show the project directory'], ['cwd', 'Show the project directory'], ['recap', 'Request a conversation recap']
]
const claudeInteractive: [string, string][] = [
  ['model', 'Choose a Claude model'], ['permissions', 'Manage native tool permissions'], ['allowed-tools', 'Manage native tool permissions'],
  ['config', 'Open settings'], ['settings', 'Open settings'], ['login', 'Connect a Claude subscription'], ['logout', 'Open agent accounts to sign out'],
  ['resume', 'Choose a saved Claude session'], ['fork', 'Branch the current session'], ['rewind', 'Choose a conversation checkpoint'], ['checkpoint', 'Restore files from a checkpoint'],
  ['clear', 'Start a new conversation with the same settings'], ['reset', 'Start a new conversation with the same settings'], ['new', 'Start a new conversation with the same settings'],
  ['rename', 'Rename this conversation'], ['name', 'Rename this conversation'], ['status', 'Inspect native session information'],
  ['cost', 'Inspect native usage'], ['usage', 'Inspect subscription limits'], ['stats', 'Inspect native usage'],
  ['mcp', 'Manage native MCP connections'], ['plugin', 'Manage Claude plugins'], ['plugins', 'Manage Claude plugins'], ['skills', 'Browse Claude skills'], ['agents', 'Manage native agents'],
  ['hooks', 'Manage lifecycle hooks'], ['memory', 'Manage project instructions'], ['output-style', 'Choose an output style'],
  ['theme', 'Configure native appearance'], ['terminal-setup', 'Configure native terminal shortcuts'], ['keybindings', 'Configure native key bindings'], ['vim', 'Configure native input editing'],
  ['statusline', 'Configure native status information'], ['feedback', 'Open native feedback'], ['bug', 'Open native feedback'], ['help', 'Show available commands and skills'],
  ['doctor', 'Inspect the native installation'], ['ide', 'Configure IDE connections'], ['add-dir', 'Add a native working directory'],
  ['export', 'Show this conversation as Markdown to copy'], ['copy', 'Show the last response to copy'], ['diff', 'Inspect project changes'],
  ['exit', 'Stop the agent process; your next message starts it again'], ['quit', 'Stop the agent process; your next message starts it again'], ['remote-control', 'Configure native remote access'], ['rc', 'Configure native remote access'],
  ['desktop', 'Continue in the provider desktop app'], ['teleport', 'Continue a remote session'], ['tasks', 'Inspect native tasks'], ['todos', 'Inspect native tasks'],
  ['voice', 'Configure native voice input'], ['tui', 'Configure native rendering'], ['privacy-settings', 'Inspect native privacy options']
]

export const NATIVE_CLI_COMMANDS = {
  codex: codexInteractive.map(([name, description]): ThreadCommand => ({ name, description, source: 'codex', execution: 'cli' })),
  claude: claudeInteractive.map(([name, description]): ThreadCommand => ({ name, description, source: 'claude', execution: 'cli' }))
}
