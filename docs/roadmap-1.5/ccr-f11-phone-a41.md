# CCR F11 · A41, the phone half: a 1.4.3 phone with desktop 1.5.0

**Criterion.** A41: "A 1.4.3 APK with desktop 1.5.0 either works or shows its existing Update the app refusal, never a
blank screen." F11-SHIP proves the desktop half (protocol version stays 1; an unknown version is refused by code). This
is the phone half: what a 1.4.3 phone runs must read what a 1.5.0 desktop sends it.

**How (MOBILE, TECH LEAD 09/11).** A frozen JVM test, `mobile/android/protocol/src/test/kotlin/com/oxespace/mobile/compat/OldPhoneReadsNewDesktopTest.kt`,
decodes with v1.4.3's own `RemoteFrames.kt` and generated `RemoteProtocol.kt` (copied unchanged from tag v1.4.3 into
`compat/v143/` as a fixture). The frames and payloads are built from the 1.5.0 generated types, with every field set
(a descriptor walk proves it, so a field added later turns the test red until it is covered):

- **Frames:** hello (with 1.5.0's `features`), snapshot and event of every topic 1.4.3 follows, ack, and every 1.5.0
  error code, both as an answer and as a stream the desktop ends (CR-34 `pane-hidden`, no id). Each must read as `Ok`.
- **Payloads:** workspaces, threads (snapshot and event), thread (snapshot and event, one item of every type), pending
  requests, terminal, jobs and delegations. Each must decode whole with 1.4.3's classes; a store that can't decode
  drops the whole list, which is a blank screen.
- **Errors:** an error code 1.4.3 doesn't know reads as `internal`; only revoked and unsupported-version may end its
  session, and only as themselves.

Out of scope: what 1.5.0 added and only sends to a phone that asks (`agents`, `paneConversation`, `agent.markSeen`,
`pane.conversation`); 1.4.3 never asks.

**Result at F10 (`oxe/f10-plan` @ e233a0d8):** green, 6/6. A mutation of the fixture (a field 1.4.3 would require and
1.5.0 doesn't send) turns it red, so the test is not vacuous. The task guards it through F11 and the version bump:
change nothing unless it fails; a failure is a desktop defect (gate the value on the client's hello, or bump the
protocol so 1.4.3 shows Update the app).
