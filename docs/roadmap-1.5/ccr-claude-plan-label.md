# CR: the Claude plan label is read live, and a stale one is never stated as fact (1.5.0 bug)

- **Owner:** BACKEND.
- **Reported by:** the user, via TECH LEAD (08/11): the usage popover says "Claude · Pro" on an Ultra plan.
- **Frozen tests, in two parts (TECH LEAD, 08/11):**
  - **Part 1, ships now:** `tests/acceptance/bugs/claude-plan-label.test.ts`, the safe fallback (§3a). It's red today because `shared/agent-plan.ts` and `planSource` don't exist.
  - **Part 2, waits for the user's OK:** `tests/acceptance/bugs/claude-plan-label-live.test.ts`, the live profile (§3b). It's in no plan until then, and **nothing that calls the profile endpoint is built or run.**
- **Needs before the execute:**
  1. the user's OK to call one more Anthropic OAuth endpoint (§2);
  2. the user's run of the probe (§2), to confirm the live field's name and the "Ultra" value.

## Cause (TECH LEAD read the plan fields; BACKEND didn't read the file)

`claudeAiOauth.subscriptionType` is `"pro"`, with `subscriptionTypeSource: "sign_in"`. `ClaudeCreditsService` copies it into `planLabel` (`claudeCredits.service.ts:69`).
- **It's frozen at sign-in,** so a plan changed afterwards leaves the label stale.
- **`claude auth status` repeats it:** its `subscriptionType`, which `native-account.service.ts` reads, is the same cached field.
- **The usage numbers are right;** they come live from `/api/oauth/usage`.
- **The user's own fix today:** `/login` in Claude Code.

## 1. What the code already knows

- **The usage call:** `GET https://api.anthropic.com/api/oauth/usage`, with the OAuth token. `buildSnapshot` reads only the `five_hour` / `seven_day` windows. Nothing in the repo shows whether the response also carries a plan; there's no captured shape of it.
- **No other live source is called today.**

## 2. A live source: the OAuth profile (to confirm)

- **The candidate:** Claude Code calls `GET https://api.anthropic.com/api/oauth/profile`, with the same token and `anthropic-beta`, for its account and organization details (`/status`).
- **The expected fields,** from Claude Code's behaviour (NOT verified):
  - `organization.organization_type` (`claude_pro`, `claude_max`, `claude_team`, `claude_enterprise`);
  - `organization.rate_limit_tier` (`default_claude_max_5x`, `default_claude_max_20x`, …);
  - `account.has_claude_max` / `has_claude_pro`.
- **BACKEND didn't call it.** That would mean reading the user's token, which is off limits to agents.

**The probe (the user runs it):** `node scripts/claude-plan-probe.mjs` from a checkout of this branch.
- It calls `/api/oauth/usage` and `/api/oauth/profile` with the user's own sign-in.
- It prints only:
  - each HTTP status;
  - the tree of field names with their types;
  - the values of plan-like fields (`plan|tier|type|subscription|has_claude`), and only booleans or short words.
- It never prints a token, email, name, id or other value, and the token goes only to `api.anthropic.com`. The script is 40 lines; read it before running it.
- **Its output settles:**
  - which endpoint and field carry the live plan;
  - what the Ultra plan is called there;
  - whether the usage response already has a plan, in which case no extra call is needed.

**The extra call is a grey area like usage's.** Anthropic restricts OAuth tokens to its own clients; the usage call was a deliberate, user-approved exception (see the service's header). Calling the profile extends that, so it needs the user's OK. Without the OK, §3's fallback alone ships.

## 3. The design

### 3a. Ships now: the safe fallback (no new endpoint)

- **Snapshot:** `planSource: 'sign-in' | null` (plus `'live'` later, in 3b). `planLabel` is a display name or null.
- **Display names:** `claudePlanName`'s fixed map (below). An unknown value gives null.
- **The renderer:** `planChip` → "Pro (do login)" with the tooltip.
- **Only the usage endpoint is called,** exactly as today. Part 1 checks that nothing else is.

### 3b. After the user's OK: the live plan

What follows, the live source and its ordering, is part 2. Shared pieces (the map, `planChip`) are part 1.

- **Plan source order:**
  1. **live** (the profile, or a plan field in the usage response if the probe finds one);
  2. **sign-in** (the cached `subscriptionType`), shown as possibly stale;
  3. **nothing.**
- **Snapshot:** `AgentCreditsSnapshot` gains `planSource: 'live' | 'sign-in' | null`. `planLabel` becomes a **display name or null**, never the raw string.
- **Display names:** `claudePlanName(raw)` in `shared/agent-plan.ts` maps a fixed table:
  - `pro`/`claude_pro` → Pro, `max`/`claude_max` → Max, `team`/`claude_team` → Team, `enterprise`/`claude_enterprise` → Enterprise;
  - with a Max tier, `default_claude_max_5x` → "Max 5x" and `default_claude_max_20x` → "Max 20x";
  - the Ultra value is added once the probe shows it;
  - **anything else gives null:** an unknown plan shows nothing rather than a guess, live or cached.
- **An unknown live value wins over the cache.** If the live source answers with a value not in the table, the label is null with `planSource: 'live'`. It never falls back to the possibly stale cached plan.
- **The profile is read at most once an hour** (a plan rarely changes), separately from usage's 60 s cache. It honours the same 429 backoff. A failure, a non-200 or a malformed body means "no live source", and the fallback applies. The usage numbers are unaffected.
- **The renderer:** `planChip(snapshot)` returns `{ text, mayBeStale }` or null, and the chip and the Usage modal render from it.
  - `mayBeStale` (from `sign-in`) shows as **"Pro (do login)"**, with the tooltip "Plano anotado quando você entrou no Claude Code; rode /login para atualizar" (en: "Plan noted when you signed in to Claude Code; run /login to update it").
  - Null gives no plan chip; the provider name alone is shown.
- **Privacy:** the snapshot carries the display name only. No token, email or id from the profile is kept or logged.

## Frozen tests (vitest, no native modules)

**Part 1** (`claude-plan-label.test.ts`, ships now) covers 3, 5 (cached), 7, and "only the usage endpoint is called". **Part 2** (`claude-plan-label-live.test.ts`, waits for the OK) covers 1, 2, 4, 5 (live) and 6.

It uses a temp credentials file and a stubbed `fetch`, never the user's files or the network:
1. **Endpoints:** both URLs are `api.anthropic.com`, and every call goes there; the token never appears in the snapshot.
2. **Live wins:** credentials say `pro` from `sign_in`, and the live profile says Max 20x, so `planLabel: 'Max 20x'`, `planSource: 'live'`.
3. **No live source:** a 404 gives `planLabel: 'Pro'`, `planSource: 'sign-in'`, and `planChip` gives `{ text: 'Pro', mayBeStale: true }`.
4. **A failing or malformed profile** falls back the same way, and the usage windows still show.
5. **Unknown values:** an unknown live value gives null with `planSource: 'live'`; an unknown cached value gives null with `planSource: null`.
6. **Cadence:** the profile is fetched at most once an hour, while usage is fetched on each forced read.
7. **The fixed display-name table,** and null for anything else, including padded, HTML or non-string values.

**The live fixture is provisional:** it follows §2's expected shape. If the probe shows another field, this CR and the fixture change together, before the execute.

## Out of scope

- Codex's plan label, which comes from `planType` in `codex` status. That's a separate check.
- Showing the plan anywhere new.
