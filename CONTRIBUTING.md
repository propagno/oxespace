# Contributing to OXESpace

Thanks for helping. This page is the short version; the
[development guide](docs/DEVELOPMENT_GUIDE.md) has the details.

## Before you start

- **Bugs and ideas:** open an [issue](https://github.com/propagno/oxespace/issues)
  using the templates. For anything security-sensitive follow [SECURITY.md](SECURITY.md).
- **Larger changes:** open an issue first so the approach can be agreed before
  you invest time. Small fixes and documentation improvements can go straight to a pull request.

## Set up

```bash
git clone https://github.com/propagno/oxespace.git
cd oxespace
npm ci
npm run rebuild:native:electron
npm run dev
```

Requirements: Node.js 22, Git, and a C/C++ toolchain for the native modules
(`node-pty`, `better-sqlite3`). On Linux see the
[Linux section](docs/DEVELOPMENT_GUIDE.md#linux-ubuntudebian-x64).

## Check your change

```bash
npm run typecheck
npm run lint
npm run test:electron     # whole suite on the Electron runtime (matches the native ABI)
npm run build
npm run test:e2e          # needs a build
```

A change is done when it follows the
[definition of done](docs/DEVELOPMENT_GUIDE.md#definition-of-done): typed IPC with
validation in the main process, tests for the behaviour you changed, no new
`!important` or hard-coded font sizes, radii or colours (use the tokens in
`src/styles/tokens.css`), and UI copy that states state rather than explains.

## Pull requests

1. Branch from `main`: `feat/…`, `fix/…`, `docs/…`.
2. Keep the change focused; unrelated clean-ups go in their own pull request.
3. Use clear commit messages in the form already used in the history —
   `feat: …`, `fix: …`, `test: …`, `docs: …`, `release: …`.
4. Fill in the pull request template. CI (typecheck, lint, tests, build, e2e on
   Windows and Linux) must pass.
5. Screenshots or a short recording help for any visual change.

## Releases

Maintainers cut releases through the single *CI and Release* workflow; see
[docs/RELEASE_PIPELINE.md](docs/RELEASE_PIPELINE.md). Contributors do not need to
bump versions.

## Conduct

Be respectful and assume good intent. Harassment or discrimination is not
tolerated; maintainers may remove comments and block accounts that break this.
