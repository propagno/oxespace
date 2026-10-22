# Origin of `vendor/codegraph`

- Upstream: [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph), published on npm as `@colbymchenry/codegraph`
- License: MIT (see `LICENSE` in this folder), Copyright (c) 2026 Colby Mchenry
- Imported into OXESpace on 2026-06-05 (commit `6b0947b`), from the upstream source of that week. The exact upstream version was not recorded; npm had `0.9.9` (2026-06-02) as its latest release then.

## Local changes

The code was copied as source and changed in OXESpace's history (`git log -- electron/main/vendor/codegraph`):

- `6b0947b`: hybrid retrieval made functional; initialization fixed in the packaged app.
- `87af988`: grammar loading for `web-tree-sitter` 0.25.9.
- `4f1e615`: MCP tool descriptions.
- `7929c51`: type-only `SyntaxNode` shim for `web-tree-sitter` 0.25.

## Bundled grammars

`extraction/wasm/` holds the compiled grammars upstream ships for languages that `tree-sitter-wasms` does not cover. Upstream does not record which repository each `.wasm` was built from; these are the canonical grammars for each language, all MIT-licensed. Confirm against upstream when updating:

| File | Project |
| --- | --- |
| `tree-sitter-lua.wasm` | [tree-sitter-grammars/tree-sitter-lua](https://github.com/tree-sitter-grammars/tree-sitter-lua) |
| `tree-sitter-luau.wasm` | [tree-sitter-grammars/tree-sitter-luau](https://github.com/tree-sitter-grammars/tree-sitter-luau) |
| `tree-sitter-pascal.wasm` | [Isopod/tree-sitter-pascal](https://github.com/Isopod/tree-sitter-pascal) |
| `tree-sitter-scala.wasm` | [tree-sitter/tree-sitter-scala](https://github.com/tree-sitter/tree-sitter-scala) |

When updating from upstream, record the version or commit here.
