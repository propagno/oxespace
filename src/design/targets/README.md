# Brand targets

The approved Mandacaru Noite target as data, next to the tokens it names, one file per BRD (`brd-NN.json`), from the approved interface, identity and scale artifacts and the BRD batch of 13/11. `e2e/brand-conformance.spec.ts` measures the built app against these files; `tests/unit/brand-targets.test.ts` keeps them valid (OXE-149).

Each measure:

| Field | Meaning |
|---|---|
| `id` | `BRD-NN.<what>.<prop>`, unique |
| `scene` | the app state it is measured in (`code-workspace`, `chat-conversation`, `settings-general`; on the phone, `theme` or `screens`) |
| `select` | a CSS selector by `data-ui`, ARIA role, tag or attribute, never by class (classes are hashed), or `{ "text": "…" }` |
| `prop` | `height`, `width`, `font-size`, `font-weight`, `font-family`, `border-radius` or `count`; on the phone, `font-size`, `font-weight`, `min-font-size`, `radius` |
| `expect` | a generated token (`{ "token": "--bar-lg" }`), one of several (`{ "oneOf": [...] }`), a fixed value (`{ "px": 2 }`, `{ "sp": 16 }`), or a count (`{ "eq": 0 }`) |
| `tolerance` | in px, at most 0.5 |
| `densities`, `themes` | where it is checked; a token resolves per density and theme, so one measure covers all four |
| `state` | `pending` reports only; `enforced` fails the PR when the app diverges |

A measure becomes `enforced` in the PR that delivers its BRD, and that PR adds its id to `enforced.lock.json`. An id never leaves the lock: an enforced measure does not go back to `pending`.

The BRD-09..24 targets come with each BRD's own PR (refine rule G34: a screen card names its BRD, its target and its measures).

## What approves the brand, and what a baseline is

Two things answer different questions, and neither stands in for the other (coordination, 14/11):

- **Brand approval** is the pair of commit statuses that pr:ready requires on every interface PR (OXE-148, OXE-149): `marca/conformidade`, posted by CI's conformance job from these targets, and `marca/fidelidade`, posted by MARCA after the side-by-side check against the approved target, for what the test does not measure.
- **A visual baseline** (`e2e/visual/__screenshots__/`, the Android goldens) is the regression net of what is built: it catches an unintended change. It does not say the screen matches the target. A surface is recorded as a baseline when it is built on the 1.5.2 identity (tokens, font, icons) and every divergence from the target is already covered by a card in progress (a BRD, OXE-100, …); the baselines PR lists, per surface, the card that will change it. A surface with a divergence that no card covers is not recorded: it gets a correction card and keeps its previous image until the fix. On a baselines PR, `marca/fidelidade` means "every divergence is carded or held back", not "matches the target".

The fidelity of a release is read from the conformance score on main (measures that match out of all checked, desktop and phone), taken after each BRD merges.
