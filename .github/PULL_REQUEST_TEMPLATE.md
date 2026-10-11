## What and why

<!-- One or two sentences: the problem and the change. Link the issue: Fixes #123 -->

## How it was checked

- [ ] `npm run typecheck` and `npm run lint`
- [ ] `npm run test:electron`
- [ ] `npm run test:e2e` (for UI or main-process changes)
- [ ] Tried it in the app (Windows / Linux)

## Notes for the reviewer

<!-- Screenshots or a short recording for visual changes. Migrations, IPC changes and new permissions should be called out. -->

## Checklist

- [ ] No credentials, tokens or private paths in code, logs or fixtures
- [ ] IPC inputs validated in the main process (if IPC changed)
- [ ] Design tokens used instead of literal sizes, radii and colours (if UI changed)
- [ ] Docs or release notes updated when behaviour changed
