# Workspace settings UI contract

## Default shell expansion

Expose existing migrated Claude, Codex, Cursor, Antigravity and Grok profiles;
retain host-native shell and the legacy Copilot shell wrapper (label it honestly,
never promise it launches Copilot). No installation or new command execution.
Two-column responsive cards grouped as Shells and Agent launchers; show friendly
name, category, executable, selection check. Use existing surface/text/accent
tokens. Native radio inputs provide arrow-key selection and visible focus.
Selected launch summary shows executable and arguments as separate read-only
fields (not a copyable shell script), with workspace-root hint and installation
warning. Never show installed/ready without checking. Empty list and missing saved
profile display actionable status. No new loading request; props supply profiles.
Selection is a draft, saved with Save workspace settings; existing save/error/busy
states are retained. Scope selector: Keep existing panes / Also update idle and
exited panes. Explain that running sessions stay untouched, agent-bound panes can
override this choice, and manual splits still open a neutral shell. Preserve the
backend's opening semantics. No optimistic mutation or automatic terminal start.

## Scope and existing system

React 19, existing Radix Dialog, Lucide icons and theme tokens from
`src/styles/tokens.css`. No new dependencies, external scripts or imagery.
No `.oxe` spec/codebase artifacts exist here; source inspection and the user's
request define this bounded visual redesign. Persistence and execution semantics
stay unchanged; profile listing is expanded as specified above.

## Navigation and layout

Keep the accessible dialog title Workspace settings and display workspace name
and root (single-line truncation with full title). Fixed header/footer, 200px left
navigation and a independently scrolling content area; width at most 1120px,
height at most 88dvh. Four native navigation buttons: Appearance, Terminal,
Project memory, Agent delegation. Active button uses aria-pressed and accent
border/tint. Tab/Enter/Space operate the buttons; Radix retains Escape/focus trap.
Below 800px navigation becomes a wrapping horizontal strip, preview stacks below
appearance settings. At 520px cards use two columns and footer wraps.

Appearance contains theme, density, layout and live preview. Terminal contains
workspace overrides and default shell. Memory and delegation get full content
width, never a competing appearance preview. Keep panels mounted but hidden so
navigation cannot discard unsaved values. Hidden panels must not receive focus.

## Visual hierarchy

Use --bg-modal, --bg-sidebar, --bg-input for surfaces; --bd-subtle/--bd-base
for separators; --tx-primary for headings, --tx-secondary for body and --tx-muted
for supporting copy. Existing accent only for selected controls and primary CTA.
13px body, 20px page heading, 11px navigation captions; 24px content padding,
16px card padding/gaps, 10px radii (local layout values, not new global tokens).
Preserve readable theme contrast and use a visible 2px accent focus outline.

## Saving and feedback

Footer: Close (does not imply rolling back immediate changes) and Save workspace
settings. Saving becomes Saving… and disables the submit button. Errors remain
inline role=alert; success closes as before. Visible guidance explains that this
button saves appearance/layout/default shell, terminal preferences apply immediately,
memory uses Apply memory settings, and delegation controls apply immediately.
No optimistic server mutations; retain existing busy, disabled and error handling.

Memory: feature description, provider/status badge, three separated preference
rows, Runtime configuration group, local/privacy notice and grouped setup actions.
Keep all field labels/CTA names for compatibility. Loading/working badge and disabled
fieldset while unavailable/loading. Failure is an inline alert with actionable
existing service message. Empty recent memories stay omitted. Successful setup
shows the existing next-step message. Dirty state preserves Apply guidance.

Delegation: opt-in explanatory card, status badge, privacy notice, useful empty
state explaining the MCP action. Task cards keep state text, report, message and
explicit controls; failed/interrupted expose Retry, review exposes Approve result,
active tasks expose Cancel task. Disabled while saving; errors inline, successful
state refresh from backend. No changes to task lifecycle.

## Acceptance

Navigation preserves drafts and exposes only the selected section to accessibility
queries; saving retains payload and errors; Escape still closes. No horizontal
overflow at desktop or 600px viewport. Inspect rendered screenshots for Appearance,
Memory and delegation, and run interaction tests plus typecheck/build.
