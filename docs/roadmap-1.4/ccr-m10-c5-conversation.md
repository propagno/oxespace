# CCR · C5 conversation for the phone's M10 screen (1.4.1)

From: MOBILE · To: BACKEND (owner of `shared/remote/protocol.ts`), TECH LEAD · cc: COORDINATOR, SECURITY · 2026-11-02

The phone's conversation screen (M10, #384) shipped in 1.4.0 with what C5 already sends. Four things the M10 design
asked for need data the desktop doesn't send yet. Each is additive, optional on the wire (an older desktop leaves it
out and the phone hides the element), and bounded. MOBILE doesn't touch `protocol.ts`: BACKEND writes the contract and
runs `android:generate`; MOBILE builds the screen on top.

## 1. Turn timer

- **Contract:** `RemoteThreadHeader`.
- **Change:** `turnElapsedMs?: number`, sent while `status` is `running` or `approval`: how long the current turn has
  run, measured on the desktop when the snapshot or event is built.
- **Why:** the screen shows "Working · 2 min" under the title, as the desktop does. A start time (`turnStartedAt`) would
  need the two clocks to agree; an elapsed time doesn't. The phone counts up from it locally and resets on the next
  snapshot or event.
- **Impact:** a number per header. No text, nothing private.

## 2. Last signal

- **Contract:** `RemoteThreadHeader`.
- **Change:** `quietMs?: number`, sent while a turn runs: time since the agent last produced anything (a delta, a tool
  event, a request).
- **Why:** a turn that has gone quiet for minutes reads as working while it may be stuck. The phone shows "No output
  for 4 min" past a threshold (DESIGN sets it), with Stop one tap away. The desktop already tracks this signal for its
  own stall hint.
- **Impact:** a number per header.

## 3. A tool step's diff

- **Contract:** `RemoteThreadItem`, `type: 'tool'`.
- **Change:** `diff?: { files: { path: string; additions: number; deletions: number }[]; patch?: string; truncated?: boolean }`
  for a step that changed files.
- **Why:** today the phone only says "2 files changed". The person deciding whether to stop or steer the agent wants to
  see what changed.
- **Limits the desktop applies before sending:**
  - `path` relative to the project, never absolute (C5 leaves turn-diff paths out today on purpose: this keeps them
    project-relative and lets the desktop drop any outside the project);
  - at most 20 files; `patch` at most 8 KB of unified diff, cut at a hunk boundary, with `truncated`;
  - the same secret redaction as tool output (`redacted` already counts it), and hidden characters written out by the
    phone as it does for output;
  - no binary content: a binary file is listed with zero counts and no patch.
- **Impact:** the largest item of this CCR. SECURITY should review the limits. The phone shows it read-only behind a
  tap, inside the screen that already blocks screenshots.

## 4. The queue

- **Contract:** `RemoteThreadHeader`.
- **Change:** `queuedPreview?: { id: string; text: string; truncated?: boolean }[]`, at most 5, each text at most
  200 characters, in send order, next to the existing `queued` count.
- **Why:** the phone can queue a message (`thread.send` while a turn runs) but can't show what is waiting, so the person
  can't tell whether what they sent is there. The desktop shows the queue.
- **Impact:** user text the phone already sent, or that the desktop's person typed; shown only in this conversation's
  screen. Removing from the queue from the phone would be another command and isn't part of this CCR.

## What MOBILE does after the contract lands

- Build the four elements on the generated types, each hidden when its field is absent.
- Paparazzi goldens in both languages, and TalkBack text ("Working for 2 minutes", "No output for 4 minutes").
- Unit tests for the local counting and for an older desktop that sends none of the fields.
