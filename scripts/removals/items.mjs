// BACKEND's cockpit removals (1.5.0 F2): one definition per item, used to generate the task list for the OXE plan and the
// frozen tests under tests/acceptance/f2/. Source: .claude/roadmap-1.4/team/plans/1.5.0-cockpit-direction.md §3.
// gone:      paths that must not exist after the task (files or folders).
// imports:   regexes no source file under electron/, src/, shared/, resources/ may match afterwards.
// tools:     MCP tool names that must not appear quoted in electron/, src/, shared/, resources/ afterwards.
// ipc:       IPC_CHANNELS group keys that must be gone.
// deps:      package.json dependencies that must be gone.
// keep:      paths that must still exist (what the item keeps).
// exists:    files that must exist and export the given names (moves, new modules).
// refs:      regexes used only to list the files a task may edit (git grep); broader than `imports`.
export const ITEMS = [
  {
    id: 'R0a', title: 'Neutral modules: projectIdentity, readJson/writePrivateJson and buildTomlTable out of memory and the CodeGraph vendor',
    depends_on: [], complexity: 'M',
    exists: { 'electron/main/services/project-identity.ts': ['projectIdentity'], 'electron/main/services/private-json.ts': ['readJson', 'writePrivateJson'], 'electron/main/services/toml.ts': ['buildTomlTable'] },
    imports: [String.raw`import\s*\{[^}]*\bprojectIdentity\b[^}]*\}\s*from\s*['"][^'"]*memory-project\.service['"]`, String.raw`import\s*\{[^}]*\b(readJson|writePrivateJson)\b[^}]*\}\s*from\s*['"][^'"]*memory-runtime['"]`, String.raw`import\s*\{[^}]*\bbuildTomlTable\b[^}]*\}\s*from\s*['"][^'"]*vendor/codegraph[^'"]*['"]`],
    refs: [String.raw`\bprojectIdentity\b`, String.raw`\b(readJson|writePrivateJson)\b`, String.raw`\bbuildTomlTable\b`],
    extra: ['tests/integration/fs-allowlist.test.ts'],
    notes: "Pure moves, no behaviour change: the functions keep their signatures. projectIdentity has 14 importers (team, coordination, delegation, conversation, memory, MCP tools); readJson/writePrivateJson are used by agent-hooks/installer.ts and semantic-model-store.ts besides memory; buildTomlTable is used by memory.service.ts and the vendored codex installer. The old modules may re-export during the task, but nothing outside them may import the moved names from the old paths (the frozen test checks this). private-json.ts imports node:fs, so it joins ALLOWED_FS_IMPORTS in fs-allowlist (and an entry removed elsewhere only if it goes away)."
  },
  {
    id: 'R0b', title: 'One-time export of the removed features\' data to <userData>/exports/1.5-removed-<ts>.json, plus the Settings › Data button',
    depends_on: ['R0a'], complexity: 'M',
    exists: { 'electron/main/services/data-export/removed-features-export.ts': ['exportRemovedFeatures', 'removedFeaturesState', 'markRemovedFeaturesNoticeShown', 'FIRST_1_5_0_DB_VERSION'] },
    runtime: 'r0b',
    refs: [String.raw`registerAuditExportIpc|exportAudit|mcpInternal\.exportAudit`],
    extra: ['electron/main/services/data-export/removed-features-export.ts', 'electron/main/ipc/data-export.ipc.ts', 'electron/main/index.ts', 'shared/types/ipc.ts', 'electron/preload/api.ts', 'src/types/window.d.ts', 'src/components/Settings/DataSettings.tsx', 'src/components/Settings/SettingsModal.tsx', 'shared/locales/en/settings.json', 'shared/locales/pt-BR/settings.json', 'shared/mcp-coverage.ts', 'docs/validation/mcp-coverage-1.4.md', 'tests/integration/fs-allowlist.test.ts', 'tests/integration/ipc-contracts.test.ts', 'tests/integration/preload-api.test.ts'],
    notes: "exportRemovedFeatures({ db, userData, workspaceRoots, previousDbVersion?, now?, force? }) → { path, created, error? }. It runs once at the first 1.5.0 start (deferred, after the window shows). It's idempotent: if <userData>/exports/1.5-removed-*.json exists it returns that path with created:false. force:true (\"export again\") always writes a new file. FE-R0b's surface (TECH LEAD, 08/11), all excluded from MCP:\n- IPC_CHANNELS.dataExport = { state: 'data-export:state', markNoticeShown: 'data-export:mark-notice-shown', exportAgain: 'data-export:export-again', open: 'data-export:open', reveal: 'data-export:reveal' };\n- open() / reveal() → void: shell.openPath / shell.showItemInFolder on the NEWEST export file. The renderer never passes a path, and with no file they do nothing (FE, 08/11).\n- state().upgrade: boolean. It's true when the database's version before the first 1.5.0 start was 1–91 (v1.4.3 shipped 91, so FIRST_1_5_0_DB_VERSION = 92, exported by the exporter). index.ts passes previousDbVersion (the user_version openDatabase found); the first run records it in exports/state.json, so it sticks on later starts. A fresh install (0) is false. DESIGN shows the band on every 1.4 upgrade.\n- preload window.oxe.dataExport.state() → { file: string | null, exportedAt: string | null, shownNotice: boolean, upgrade: boolean, error: string | null, removed: Array<{ id, hadData, hadSettings }> }. error is the last failure of this app run (HML-678-2), null after a success. file is the full path of the newest export (the UI shows the basename, with the path in a tooltip). exportedAt is its ISO time. Both are null when nothing needed saving (DESIGN, 08/11).\n- **Failure (HML-678-2):** an unwritable exports/ or a failed write leaves no partial file. The write is atomic through writePrivateJson (a temp file then a rename inside that helper, never in the exporter). exportRemovedFeatures returns { path: null, created: false, error } without throwing; the once-marker is NOT set, so the next start retries; state().error carries it, and FE-R0b's band says the data wasn't saved.\n- **User files untouched (HML-678-1):** the exporter only reads .oxespace/requests/** and never reads oxepost-secrets.json. The export holds secretsNote, a one-line statement that secret values weren't copied and stay in OXESpace's data (HML-678-3; DESIGN writes the dialog line). Only open workspaces are scanned (HML-678-4: the dialog says \"from your open workspaces\").\n- **Nothing to save:** when every section is empty, no file is written; the run is recorded in exports/state.json so it isn't retried at each start; exportRemovedFeatures returns { path: null, created: false }, and exportAgain returns { file: null }. removed (DESIGN via FE) lists only the removed features this install used; id is one of 'codegraph' | 'semantic' | 'rtk' | 'memory' | 'linear' | 'teams' | 'automations' | 'docs' | 'oxepost' | 'oxepod' | 'work'. hadData is computed in main from the DB rows, the automations file, the collections folders and .oxe/codegraph.db; hadSettings from that feature's settings (a Linear token, RTK enabled, memory enabled…). An entry appears only if one of the two is true. No content leaves main: only ids and booleans;\n- markNoticeShown() → void, idempotent, stored in <userData>/exports/state.json;\n- exportAgain() → { file: string | null }.\nThe service exports removedFeaturesState({ db, userData, workspaceRoots }) and markRemovedFeaturesNoticeShown(userData) for those handlers. Sections:\n- oxepostCollections: the files under each workspace's .oxespace/requests, with path and text, and environments with secret NAMES only (never values; oxepost-secrets.json is never read);\n- memories: the rows of memory_projects, memory_notes, memory_note_uses and memory_runtime if the tables exist;\n- automations: the automations and automation_runs rows from <userData>/automations.sqlite3, opened read-only if it exists. It's the automations store's own database, not the app's.\nA missing table, folder or file is an empty section, never an error. The file is written with writePrivateJson (R0a). The Settings › Data button is renderer code, so it's FE's paired task (FE-R0b); this task gives it the IPC and the preload method. DESIGN reviews the copy at M5."
  },
  {
    id: 'R0c', title: 'Move preview-automation and preview-capture-store out of documentation/ into services/browser-preview/',
    depends_on: ['R0b'], complexity: 'S',
    exists: { 'electron/main/services/browser-preview/preview-automation.ts': [], 'electron/main/services/browser-preview/preview-capture-store.ts': [] },
    gone: ['electron/main/services/documentation/preview-automation.ts', 'electron/main/services/documentation/preview-capture-store.ts'],
    imports: [String.raw`from\s*['"][^'"]*documentation/preview-(automation|capture-store)['"]`],
    refs: [String.raw`preview-automation|preview-capture-store`],
    extra: ['tests/integration/fs-allowlist.test.ts'],
    notes: 'A pure move so R9 can delete documentation/ without losing the web-preview automation (oxespace_preview_interact and the preview capture stay). The fs-allowlist entries move with the files.'
  },
  {
    id: 'R0d', title: 'Delegation enrich without AI Memory or CodeGraph',
    depends_on: ['R0c'], complexity: 'S',
    custom: 'r0d',
    refs: [String.raw`enrich\b|includeMemory|codegraph_explore`],
    extra: ['electron/main/index.ts'],
    notes: "index.ts 437–456: enrich no longer calls memoryService or codeGraphService, nor imports vendor/codegraph. It returns { memory: '', code: '' } or the option is removed; the delegation keeps its explicit handoff. The includeMemory flag on a task is ignored (kept on the wire for one release so older callers don't fail)."
  },
  {
    id: 'R4', title: 'Remove RTK (rtk.service, its IPC and the PATH change in the terminal)',
    depends_on: ['R0a', 'R0b', 'R0c', 'R0d'], complexity: 'S',
    gone: ['electron/main/services/rtk.service.ts', 'electron/main/services/rtk-checksum.ts', 'tests/rtk-checksum.test.ts', 'tests/integration/updater.rtk.test.ts'],
    imports: [String.raw`from\s*['"][^'"]*rtk(\.service|-checksum)['"]`, String.raw`IPC_CHANNELS\.rtk\b`, String.raw`window\.oxe\.rtk\b`],
    ipc: ['rtk'],
    refs: [String.raw`rtk\.service|rtk-checksum|registerRtkIpc|IPC_CHANNELS\.rtk|window\.oxe\.rtk|oxe\.rtk\b|\brtk(Path|Bin|Dir|Enabled|Status)\b`],
    notes: 'Nothing replaces it. terminal.service.ts stops prepending the RTK folder to PATH; updater.store.ts drops its RTK state; Settings stops showing it. Token-bench result files under tests/token-bench/results are history and are not edited.'
  },
  {
    id: 'R6', title: 'Remove Linear (service, IPC, oxespace_linear, store and UI)',
    depends_on: ['R0a', 'R0b', 'R0c', 'R0d'], complexity: 'S',
    gone: ['electron/main/services/linear.service.ts', 'electron/main/ipc/linear.ipc.ts', 'src/store/linear.store.ts', 'src/components/Linear', 'tests/integration/linear.service.test.ts'],
    imports: [String.raw`from\s*['"][^'"]*(linear\.service|linear\.ipc|linear\.store)['"]`, String.raw`IPC_CHANNELS\.linear\b`, String.raw`window\.oxe\.linear\b`],
    tools: ['oxespace_linear'], ipc: ['linear'],
    refs: [String.raw`linear\.service|linear\.ipc|linear\.store|IPC_CHANNELS\.linear|window\.oxe\.linear|oxespace_linear|registerLinearIpc|components/Linear`],
    extra: ['shared/mcp-coverage.ts', 'docs/validation/mcp-coverage-1.4.md'],
    notes: "Replaced by Linear's official MCP. Its mcp-coverage entry and the linear.token forbidden capability go (FORBIDDEN_CAPABILITIES only shrinks). The bridge's tool list (resources/mcp-bridge/oxespace-mcp.cjs) and thread-mcp's groups drop the tool."
  },
  {
    id: 'R8', title: 'Remove scheduled automations (service, IPC, MCP tools and UI)',
    depends_on: ['R0a', 'R0b', 'R0c', 'R0d'], complexity: 'M',
    gone: ['electron/main/services/automations', 'electron/main/ipc/automations.ipc.ts', 'electron/main/mcp-internal/automation-tools.ts', 'tests/integration/automation-tools.test.ts', 'tests/integration/automations.test.ts'],
    imports: [String.raw`from\s*['"][^'"]*(services/automations|automations\.ipc|automation-tools)[^'"]*['"]`, String.raw`IPC_CHANNELS\.automations\b`, String.raw`window\.oxe\.automations\b`],
    tools: ['oxespace_automations', 'oxespace_automations_change'], ipc: ['automations'],
    refs: [String.raw`services/automations|automations\.ipc|automation-tools|automationTools|IPC_CHANNELS\.automations|window\.oxe\.automations|oxespace_automations|registerAutomationsIpc|AUTOMATIONS_CHANGE`],
    extra: ['shared/mcp-coverage.ts', 'docs/validation/mcp-coverage-1.4.md'],
    data: true,
    notes: 'Replaced by /loop, scheduled routines and cron. The automations and automation_runs tables are created at runtime by the store, not by a migration; they are left in the database (no DROP) and their rows are in the R0b export.'
  },
  {
    id: 'R2', title: 'Remove semantic search (services, IPC, oxespace_semantic_search, @xenova/transformers); tables 039–044 stay',
    depends_on: ['R0a', 'R0b', 'R0c', 'R0d'], complexity: 'M',
    gone: ['electron/main/services/semantic.service.ts', 'electron/main/services/semantic-chunk.ts', 'electron/main/services/semantic-ignore.ts', 'electron/main/services/semantic-model-store.ts', 'electron/main/services/semantic-model.ts', 'electron/main/services/semantic-projects.ts', 'electron/main/services/semantic-retrieval.ts', 'electron/main/ipc/semantic.ipc.ts', 'src/components/Semantic'],
    imports: [String.raw`from\s*['"][^'"]*/semantic(\.service|-chunk|-ignore|-model-store|-model|-projects|-retrieval|\.ipc)['"]`, String.raw`@xenova/transformers`, String.raw`IPC_CHANNELS\.semantic\b`, String.raw`window\.oxe\.semantic\b`],
    tools: ['oxespace_semantic_search'], ipc: ['semantic'], deps: ['@xenova/transformers'],
    keep: ['electron/main/db/migrations/039_semantic_embeddings.sql', 'electron/main/db/migrations/040_semantic_embedding_blob.sql', 'electron/main/db/migrations/043_semantic_lexical_index.sql', 'electron/main/db/migrations/044_semantic_chunk_metadata.sql'],
    refs: [String.raw`semantic(\.service|-chunk|-ignore|-model-store|-model|-projects|-retrieval|\.ipc)|@xenova/transformers|IPC_CHANNELS\.semantic|window\.oxe\.semantic|oxespace_semantic_search|SemanticService|components/Semantic|bench:semantic`],
    extra: ['package.json', 'package-lock.json', 'electron.vite.config.ts', 'shared/mcp-coverage.ts', 'docs/validation/mcp-coverage-1.4.md', 'tests/integration/fs-allowlist.test.ts'],
    notes: "Agents use their own native ripgrep. Migrations 039–044 stay (no DROP); the tables stay in the database. @xenova/transformers leaves package.json and the lock without a full npm install (npm uninstall --package-lock-only, or an equivalent lock edit), along with any onnxruntime/sharp packaging rules it alone needed (electron-builder files, asarUnpack, electron.vite.config externals). The bench:semantic scripts and scripts/semantic-*.mjs go too. The keep path is checked: migration 039's file must still exist."
  },
  {
    id: 'R3', title: 'Remove oxespace_hybrid_explore and rewrite the MCP INSTRUCTIONS (≤ 600 characters)',
    depends_on: ['R2'], complexity: 'S',
    custom: 'r3',
    tools: ['oxespace_hybrid_explore'],
    imports: [String.raw`hybridExplore\b|hybrid-explore`],
    refs: [String.raw`oxespace_hybrid_explore|hybridExplore|hybrid-explore|INSTRUCTIONS`],
    extra: ['resources/mcp-bridge/oxespace-mcp.cjs', 'shared/mcp-coverage.ts', 'docs/validation/mcp-coverage-1.4.md'],
    notes: "INSTRUCTIONS in resources/mcp-bridge/oxespace-mcp.cjs (line ~49) is rewritten. It's at most 600 characters, and names no removed tool (hybrid explore, semantic search, code_*, memory, linear, automations, documentation). The bridge's gate at ~line 236 (instructions only when oxespace_hybrid_explore is allowed) changes too, so the instructions don't vanish when hybrid explore goes: send them unless STEPS_ASIDE or UNCONNECTED. The frozen test checks the length and that no removed name appears anywhere in the bridge (spec test T8)."
  },
  {
    id: 'R1', title: 'Remove the vendored CodeGraph (vendor/codegraph, codegraph.service, oxespace_code_*); web-tree-sitter stays for shell parsing',
    depends_on: ['R3'], complexity: 'L',
    gone: ['electron/main/vendor/codegraph', 'electron/main/services/codegraph.service.ts', 'electron/main/mcp-internal/code-graph-tools.ts'],
    imports: [String.raw`from\s*['"][^'"]*vendor/codegraph[^'"]*['"]`, String.raw`import\(['"][^'"]*vendor/codegraph`, String.raw`codegraph\.service`, String.raw`code-graph-tools`],
    tools: ['oxespace_code_search', 'oxespace_code_node', 'oxespace_code_callers', 'oxespace_code_callees', 'oxespace_code_impact', 'oxespace_code_status'],
    deps: [], keepDeps: ['web-tree-sitter', 'tree-sitter-wasms'], keep: ['electron/main/services/conversation/shell-parse.ts'],
    refs: [String.raw`vendor/codegraph|codegraph\.service|code-graph-tools|CodeGraphService|codeGraphService|oxespace_code_|copy-codegraph-assets|codegraph`],
    extra: ['package.json', 'electron.vite.config.ts', 'electron-builder.yml', 'shared/mcp-coverage.ts', 'docs/validation/mcp-coverage-1.4.md', 'tests/remote-ipc-contract.test.ts', 'tests/integration/fs-allowlist.test.ts'],
    notes: "Replaced by a shortcut that adds CodeGraph's external MCP. web-tree-sitter and tree-sitter-bash.wasm stay for shell parsing (conversation/shell-parse.ts). The electron.vite.config.ts plugin copy-codegraph-assets becomes copy-shell-parse-assets: it copies only web-tree-sitter's runtime wasm and tree-sitter-bash.wasm (from tree-sitter-wasms/out), not the vendor's extraction/wasm. Both packages stay in package.json (keepDeps). tests/remote-ipc-contract.test.ts drops its vi.mock of vendor/codegraph. All the vendor folder's fs-allowlist entries go (the ratchet only shrinks). About 43k lines go."
  },
  {
    id: 'R5', title: 'Remove AI Memory (services/memory, its IPC and MCP tools, the agent hook); migrations 047/082 and memory_projects stay',
    depends_on: ['R1'], complexity: 'L',
    gone: ['electron/main/services/memory', 'electron/main/ipc/memory.ipc.ts', 'electron/main/ipc/memory-manage.ipc.ts', 'electron/main/mcp-internal/memory-tool-handlers.ts', 'resources/memory/agent-hook.cjs'],
    imports: [String.raw`from\s*['"][^'"]*services/memory/[^'"]*['"]`, String.raw`memory-tool-handlers`, String.raw`memory(-manage)?\.ipc`, String.raw`IPC_CHANNELS\.memory\b`, String.raw`window\.oxe\.memory\b`],
    tools: ['oxespace_memory_search', 'oxespace_memory_remember', 'oxespace_memory_sessions', 'oxespace_memory_handoffs', 'oxespace_memory_accept_handoff'],
    ipc: ['memory'],
    keep: ['electron/main/db/migrations/047_project_memory.sql', 'electron/main/db/migrations/082_memory_notes.sql'],
    runtime: 'r5',
    refs: [String.raw`services/memory/|memory-tool-handlers|memory(-manage)?\.ipc|IPC_CHANNELS\.memory|window\.oxe\.memory|oxespace_memory_|memoryService|MEMORY_TOOLS|agent-hook\.cjs|resources/memory`],
    extra: ['shared/mcp-coverage.ts', 'docs/validation/mcp-coverage-1.4.md', 'tests/integration/fs-allowlist.test.ts', 'electron-builder.yml', 'electron/main/services/agent-hooks/installer.ts'],
    data: true,
    notes: "Replaced by a link to CLAUDE.md/AGENTS.md. The migrations stay: 047 creates memory_projects, which v59's migrateThreadProjects reads (db/index.ts:549), and 082 creates memory_notes, so nothing is dropped. The installed agent hook is uninstalled once (agent-hooks installer) so agents stop calling a script that no longer ships. oxespace_project_context STAYS (context discovery): it moves out of memory-tool-handlers.ts and must not depend on memory. The memory rows are in the R0b export. The frozen R5 integration test replays from v58 on a database with memory rows and checks it reaches LATEST with every table kept."
  },
  {
    id: 'R7', title: 'Remove the Teams UI and team IPC/MCP; the coordination core used by Delegation stays (050–052, 061/062 kept in the DB)',
    depends_on: ['R5'], complexity: 'M',
    gone: ['electron/main/ipc/team.ipc.ts', 'electron/main/mcp-internal/team-tools.ts', 'src/components/Teams'],
    imports: [String.raw`from\s*['"][^'"]*(team\.ipc|team-tools|components/Teams)[^'"]*['"]`, String.raw`IPC_CHANNELS\.team\b`, String.raw`window\.oxe\.team\b`],
    tools: ['oxespace_team_status', 'oxespace_team_inbox', 'oxespace_team_message', 'oxespace_team_acknowledge'],
    ipc: ['team'],
    keep: ['electron/main/services/coordination/coordinator.ts', 'electron/main/db/migrations/061_persistent_teams.sql', 'electron/main/db/migrations/062_team_delivery.sql'],
    refs: [String.raw`team\.ipc|team-tools|registerTeamIpc|IPC_CHANNELS\.team|window\.oxe\.team|oxespace_team_|components/Teams|TEAM_TOOLS`],
    extra: ['electron/main/index.ts', 'shared/mcp-coverage.ts', 'docs/validation/mcp-coverage-1.4.md'],
    notes: 'services/coordination stays, as Delegation uses it. A coordination/team-* file goes only if nothing outside the removed files imports it (typecheck proves it). Tables 061/062 stay. The Team button is already out of the title bar (31/10).'
  },
  {
    id: 'R8b', skip: true
  },
  {
    id: 'R9', title: 'Remove the documentation tools (services/documentation, oxespace_documentation_*); 049 stays in the DB',
    depends_on: ['R0c'], complexity: 'M',
    gone: ['electron/main/services/documentation', 'electron/main/mcp-internal/documentation-tools.ts', 'electron/main/mcp-internal/documentation-handler.ts'],
    imports: [String.raw`from\s*['"][^'"]*(services/documentation|documentation-tools|documentation-handler)[^'"]*['"]`],
    tools: ['oxespace_documentation_create', 'oxespace_documentation_get', 'oxespace_documentation_list', 'oxespace_documentation_capture', 'oxespace_documentation_checkpoint', 'oxespace_documentation_image', 'oxespace_documentation_export'],
    keep: ['electron/main/services/browser-preview/preview-automation.ts', 'electron/main/services/browser-preview/preview-capture-store.ts'],
    refs: [String.raw`services/documentation|documentation-tools|documentation-handler|DOCUMENTATION_TOOLS|oxespace_documentation_|DocumentationService`],
    extra: ['shared/mcp-coverage.ts', 'docs/validation/mcp-coverage-1.4.md', 'tests/integration/fs-allowlist.test.ts'],
    notes: "oxespace_preview_interact STAYS: it is web-preview automation, which R0c moved to services/browser-preview, so it is re-registered outside documentation-tools.ts. Migration 049 and its tables stay."
  },
  {
    id: 'R13', title: 'Work folds into Delegation: services/work and work-tools go; oxespace_work_* stay one release as aliases; the work enum stays on the phone',
    depends_on: ['R7'], complexity: 'L',
    gone: ['electron/main/services/work', 'electron/main/mcp-internal/work-tools.ts'],
    imports: [String.raw`from\s*['"][^'"]*(services/work/|work-tools)[^'"]*['"]`],
    custom: 'r13',
    refs: [String.raw`services/work/|work-tools|WORK_TOOLS|oxespace_work_|WorkService|workService|'work'`],
    extra: ['shared/mcp-coverage.ts', 'docs/validation/mcp-coverage-1.4.md', 'shared/remote/protocol.ts'],
    notes: "Delegation with dependencies replaces Work. Dependency fields (FE-R13's \"Waits for\" and \"Blocked\"): DelegationInput gains dependsOn?: string[] (ids of the tasks it waits for); DelegationTask gains dependencies: Array<{ id: string; objective: string; state: DelegationState }>, resolved in main when read. A task waits while any dependency isn't 'approved', and is blocked when one is 'failed', 'cancelled' or 'interrupted'. oxespace_work_plan/status/result/message/cancel stay registered for one release as aliases that route to delegation (each description says so); they leave in 1.5.x. On the phone, REMOTE_AGENT_KINDS keeps 'work' (an older phone still decodes it), but the desktop stops emitting work rows. The frozen test checks the aliases are still registered, the work module is gone, and protocol.ts still lists 'work'. The work_* tables stay."
  },
  {
    id: 'R14-be', title: 'Remove the OxePost backend (services/oxepost, oxepost.ipc, shared/oxepost); the HTTP panel (H1–H3) replaces the mode',
    depends_on: ['R13', 'R0b'], complexity: 'M',
    gone: ['electron/main/services/oxepost', 'electron/main/ipc/oxepost.ipc.ts'],
    imports: [String.raw`from\s*['"][^'"]*(services/oxepost/|oxepost\.ipc)[^'"]*['"]`, String.raw`IPC_CHANNELS\.oxePost\b`, String.raw`window\.oxe\.oxePost\b`],
    ipc: ['oxePost'],
    refs: [String.raw`services/oxepost|oxepost\.ipc|registerOxePostIpc|IPC_CHANNELS\.oxePost|window\.oxe\.oxePost|shared/oxepost|oxepost`],
    extra: ['electron/main/ipc/thread.ipc.ts', 'electron/main/e2e/mock-ipc.ts', 'shared/mcp-coverage.ts', 'docs/validation/mcp-coverage-1.4.md', 'tests/integration/fs-allowlist.test.ts'],
    data: true,
    notes: "It lands in the same release as FE's UI part of R14 (the mode view, the post namespace in i18n), in one PR or two consecutive ones on the train; agree the split with FE. shared/oxepost may keep only what H1–H3 reuse (redact helpers). The collections stay as the user's files in their repos, and are in the R0b export; the secrets file in userData is left on disk, unread. Frozen (HML-678-1, r14-be-user-files-kept.test.ts): nothing in electron/ mentions oxepost-secrets after this task, and only the exporter references the request folders, without rm/unlink/rename."
  },
  {
    id: 'R11-be', title: 'Drop fs:write-file (the read-only Monaco has no writer left); paired with FE-R11',
    depends_on: ['R14-be', 'R15-be'], complexity: 'S',
    custom: 'r11',
    imports: [String.raw`IPC_CHANNELS\.fs\.writeFile\b`, String.raw`window\.oxe\.fs\.writeFile\b`, String.raw`parseFileSystemWriteFileInput\b`],
    refs: [String.raw`fs\.writeFile\b|IPC_CHANNELS\.fs\.writeFile|parseFileSystemWriteFileInput|FileSystemWriteFile(Input|Result)|fileSystemService\.writeFile`],
    extra: ['shared/types/ipc.ts', 'electron/preload/api.ts', 'src/types/window.d.ts', 'electron/main/ipc/file-system.ipc.ts', 'electron/main/ipc/validation.ts', 'electron/main/services/file-system.service.ts', 'shared/types/filesystem.ts', 'tests/integration/fs-allowlist.test.ts'],
    notes: "fs:write-file has one caller on main, the editor store, which FE-R11 removes with Monaco editing. The channel, its preload entry, its validator, FileSystemService.writeFile and the write types go; reading, listing and watching stay (the read-only viewer, SqlEditor and MonacoDiff use them). If fs-allowlist has an entry that exists only for the write path, it goes (the ratchet only shrinks)."
  },
  {
    id: 'R15-be', title: 'OxePod mode goes (FE); its backend stays — guard that nothing backend is removed',
    depends_on: ['R13'], complexity: 'S',
    keep: ['electron/main/services/oxepod', 'electron/main/ipc/oxepod.ipc.ts'],
    custom: 'r15',
    refs: [String.raw`IPC_CHANNELS\.oxePod|oxespace_container`],
    extra: [],
    notes: "FE removes the mode view (UI part of R15). The backend stays for the Containers panel (P1): services/oxepod, oxepod.ipc, IPC_CHANNELS.oxePod and the container MCP tools. The frozen test is a guard that these still exist after the FE PR."
  }
].filter(item => !item.skip)
