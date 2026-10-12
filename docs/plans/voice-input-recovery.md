# Voice input recovery — 2026-09-17

The terminal voice HUD previously retained errors without a dismiss control and
ignored pointer events. An aborted microphone request left its message visible
and the same toggle attempted another capture instead of closing the error.

The HUD now exposes **Close voice input** and handles Escape within its own
terminal pane before that key reaches the CLI. Closing restores the terminal's
input focus. Ctrl+Shift+V also dismisses an error or a pending startup/transcription.
The requesting state is visible and can be closed while permission is pending.

Dismissal stops any active recorder, discards audio and clears the status/error.
An operation generation prevents late microphone, recorder, model preparation or
transcription results from reopening the HUD or inserting text. A late microphone
stream is stopped. Model preparation/transcription already running in the main
process may finish, but their results are ignored by the dismissed capture.
Duplicate starts while awaiting microphone permission are rejected. A later
activation can retry. Aborted permission requests show a clear retry message.

Verification: nine voice hook/HUD tests passed, including existing recording,
transcription and download behavior plus abort/permission recovery, Escape
isolation, duplicate starts and late microphone/model/transcription results.
The Electron UI test reproduced AbortError through Ctrl+Shift+V, closed the HUD
by button, Escape and shortcut, and verified restored terminal focus.
Capture: `test-results/voice-error-dismissible.png`. Typecheck, production build
and lint passed (zero lint errors; 32 existing warnings). Real microphone capture
remains dependent on the machine's device and permission configuration.
