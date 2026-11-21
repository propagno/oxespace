# CCR: the cockpit removals, backend side (1.5.0, phase F2: R0a–R0d, R1–R9, R11, R13, R14, R15)

- **Owner:** BACKEND.
- **Source:** `.claude/roadmap-1.4/team/plans/1.5.0-cockpit-direction.md` §3, approved by the user on 08/11. Criteria A48 and A57.
- **Built by:** the OXE executor, from the F2 PLAN.json.
- **The task list:** `.claude/roadmap-1.4/team/plans/f2-removals-BACKEND.json`, 17 tasks. It's generated, with this PR's frozen tests, from `scripts/removals/items.mjs` by `scripts/removals/generate.mjs`. Edit `items.mjs` and rerun: `node scripts/removals/generate.mjs <tasks-json-path>`.
- **Reviews (M5):** HML reviews the frozen tests. DESIGN reviews R0b's copy, which is shown by FE-R0b.

## What each task carries

Per item: `files` (every path it may create, edit or delete; a trailing `/` means the whole folder), `hot_files` (index.ts, thread.ipc.ts or electron.vite.config.ts, which the scheduler serializes), `affected_suites`, `verify` (one command per check: the frozen tests, then the governance suites), `proves` (the exact test titles), `complexity`, and `notes` with the decisions.

## Rules every removal follows (§3)

- **Governance in the same PR:** mcp-coverage (plus its validation doc), fs-allowlist, i18n-catalog and remote-ipc-contract. The ratchets only shrink.
- **No migration drops a table.** The frozen R5 test replays from v58 on a database with memory rows, and checks every kept table.
- **Backend-only:** FE's paired task (FE-<id>) owns `src/**`, except `src/types/window.d.ts`. The frozen test also scans `src/` and lists renderer paths in GONE, so both halves land together.
- **Build green:** typecheck and design-lint are task gates added by the plan, so they aren't repeated in `verify`.

## Order

1. R0a → R0b → R0c → R0d.
2. Then R4, R6, R8 and R2 in parallel.
3. Then R3 → R1.
4. Then R5 → R7 → R13 → R15-be → R14-be → R11-be.

R9 needs only R0c. The hot files serialize the parallel steps.

## Decisions taken here (details in each task's notes)

- **R0b:**
  - `exportRemovedFeatures({ db, userData, workspaceRoots, now?, force? })` writes `<userData>/exports/1.5-removed-<ts>.json` once. It covers OxePost collections (secret names only, never values), memories, and automations (read from `<userData>/automations.sqlite3`, the automations store's own database).
  - **FE-R0b's surface:** `IPC_CHANNELS.dataExport = { state, markNoticeShown, exportAgain }`.
    - `state()` → `{ file, shownNotice, removed: Array<{ id, hadData, hadSettings }> }`. `removed` lists only the features this install used, as ids and booleans: no content leaves main.
    - `markNoticeShown()` is stored in `exports/state.json`.
    - `exportAgain()` is `force`, a new file.
- **R0d:** enrich no longer uses memory or CodeGraph.
- **R1:** `web-tree-sitter` and `tree-sitter-wasms` stay for `shell-parse.ts`. `copy-codegraph-assets` becomes `copy-shell-parse-assets`.
- **R3:** INSTRUCTIONS is ≤ 600 characters and no longer gated on hybrid explore.
- **R5:** migrations 047 and 082 stay (v59's `migrateThreadProjects` reads `memory_projects`). `oxespace_project_context` stays. The agent hook is uninstalled once.
- **R9:** `oxespace_preview_interact` stays, through `services/browser-preview` (moved by R0c).
- **R13:** `oxespace_work_*` stay one release as aliases to delegation, and the phone keeps the `work` kind.
- **R11-be:** `fs:write-file`, its validator and `FileSystemService.writeFile` go.
- **R15-be:** a guard that the OxePod backend stays.

## Frozen tests (`tests/acceptance/f2/`, lint-clean)

- **One static test per item** (`<id>-removal.test.ts`):
  - the removed paths are gone;
  - nothing imports what was removed;
  - the MCP tools are gone from the app, the bridge and the coverage;
  - the IPC groups are gone;
  - the package.json entries are dropped or kept as listed;
  - the kept paths are still there;
  - the moved or new modules export their names;
  - the data is covered by the export.
- **Hand-made tests:**
  - `r0b-removed-features-export.native.test.ts` (Electron ABI): the export, idempotence, no secret, FE-R0b's state, "export again", and the IPC names;
  - `r5-v58-upgrade.native.test.ts` (Electron ABI);
  - `r0d-delegation-enrich.test.ts`;
  - `r3-mcp-instructions.test.ts`;
  - `r13-work-aliases.test.ts`;
  - `r11-be-no-write-file.test.ts`;
  - `r15-oxepod-backend-kept.test.ts`.
- **Today:** 55 checks are red for the right reason, because what they remove still exists. The keep checks, R15's guard, R13's phone check and R5's replay are green. R0b fails only because its module doesn't exist yet.
