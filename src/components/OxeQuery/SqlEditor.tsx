// Side-effect: self-hosted Monaco (no CDN), required before <Editor> mounts. Loaded on first use (SqlWorkbench), so
// the OxeQuery view's chunk, and its idle preload, carry no Monaco.
import '../../lib/monacoSetup'
export { default } from '@monaco-editor/react'
