# CCR (phone phase, 1.5.0): the Agents tab, and steer while working

- **Owner:** MOBILE (oxespace-29).
- **Acceptance:** A43 and A47.
- **Phase:** Fase 10, Celular.
- **Status:** draft. DESIGN reviews the UI, and HML reviews the field question (M10), before any execute.
- **Depends on:** CCR phone-screens (#688), T-P1.2 components: StatusGlyph, ProviderAvatar, OxeButton, Notice,
  EmptyState.
- **Inputs:**
  - `team/checklists/phone-phase-inputs.md` (M7 from #521, with DESIGN's chip decision M7.7);
  - the S7.1 C5 `agents` block, already on main (#531);
  - the approved #627 (M3, M4, M7);
  - #521, the closed reference implementation (branch `feat/mobile-s7-4-agents-ui`).

## Rules

- **No protocol change.** `agents`, `agent.markSeen`, `thread.steer` and `thread.interrupt` are all on main.
- **No fake data,** in the app or in a release build (A43).
- **Read-only, except where S2 allows it.** Only a conversation's answerable request is answered on the phone.

## T-P2.1 Agents (M7, A43)

- **New files:**
  - `mobile/android/app/src/main/java/com/oxespace/mobile/agents/AgentsStore.kt`: the model and store. Port #521's
    `Agents.kt` without its fake source.
  - `.../agents/AgentsViewModel.kt`: subscribes to `agents` through `LiveRepository` and sends `agent.markSeen`.
  - `.../agents/AgentsScreen.kt`.
- **Changed files:**
  - `.../session/LiveRepository.kt`: add the `agents` stream to the followed subscriptions, so it replays after a
    reconnect like the others.
  - `.../ui/live/LiveHome.kt`: the Agents tab content.
  - `shared/locales/{en,pt-BR}/mobile.json`, plus `npm run android:generate`.
- **Behaviour,** all already specified in `phone-phase-inputs.md`:
  - **The store:** a snapshot replaces all held rows, tombstones included. An upsert or removal applies only above the
    highest `rev` seen for its `(kind, id)`; removed keys stay as tombstones.
  - **Unknown values:** an unknown `kind` is dropped; an unknown `state` reads "Not confirmed"; an unknown source adds
    to the partial Notice.
  - **Order:** state precedence, then longest in that state, then kind and id.
  - **Chips (M7.7):** single-select and horizontally scrolling, 48 dp, each with its count: **All · Needs you · Working
    · Failed · Finished.** Idle, Stopped and Not confirmed show under All only.
  - **Taps:** a conversation with an answerable request goes to that request; anything else opens its source.
  - **`agent.markSeen {kind, id}`:** only when a **Finished** row is opened.
  - **Never shown:** paths, worktrees, session ids, cost.
  - **Partial sources:** the info Notice "Some agents couldn't be read right now. The rest is up to date."
- **Frozen tests:**
  - **new** `.../agents/AgentsStoreTest.kt`, ported from #521's `AgentsTest`:
    - rev ordering and tombstones;
    - an unknown kind dropped, an unknown state as Not confirmed;
    - the sort order;
    - the 5 chips' filters and counts;
  - **new** `.../agents/AgentsWireTest.kt`, from #521: generated `RemoteAgentRow` → model; an unknown source reaches the
    Notice;
  - **new** `.../agents/AgentsActionsTest.kt`:
    - the tap target: an answerable conversation request goes to the request;
    - `markSeen` is sent only on a finished row;
  - `ScreensSnapshotTest.agents`: all 7 states, each chip, empty, partial, in en/pt-BR × light/dark;
  - **emulator (API 36):** new `androidTest/.../agents/AgentsOnDeviceTest.kt`, against the in-test fake gateway
    (MockWebServer, as `SessionOnDeviceTest` does):
    - subscribe, receive a snapshot, then an upsert;
    - opening a finished row sends `agent.markSeen`.

## T-P2.2 Steer while working (A47)

- **Files:** `.../ui/live/ThreadScreen.kt` (the `Composer`), plus the strings.
- **Behaviour:**
  - **While the agent works:** the field shows **Stop** (secondary) · text · **Send the instruction.**
  - **Enter** sends too.
  - **In the conversation:** the line "read after the current step" appears under the sent text, until the next item
    arrives.
  - **Stop** keeps its confirm dialog: 3 taps, per the parity checklist.
  - **Presence (S8)** still applies, with the 5-minute window.
  - **Not working, or `canSteer` false:** the 1.4 composer, Send only.
- **Frozen tests:**
  - **new** `.../ui/live/ComposerModeTest.kt`, a pure function from status and `canSteer` to the controls:
    - working + canSteer → Stop + Steer;
    - working without canSteer → Stop, and Send queues;
    - idle → Send;
  - `ScreensSnapshotTest.conversation`: working with the steer composer, and the "read after the current step" line;
  - `TimelineTest`: the pending-steer line clears when a newer item arrives.

## Field question (M10, HML)

- **On the stand-in phone (R143), against a real gateway:**
  - the Agents tab shows the desktop's agents, and opening a finished one clears its badge on the desktop;
  - a steer while a stand-in agent works is received after its current step.
- **Busy case:** many agents changing state at once. The store's `rev` rules keep the list stable; HML checks that it
  doesn't jump.

## Out of scope

- Agents grouped by workspace. That's 1.5.x and needs a C5 field (MG1).
- Removing a queued message from the phone.
