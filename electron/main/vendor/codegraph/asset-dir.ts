import * as path from 'path'

/**
 * Directory holding CodeGraph's on-disk assets at runtime: `schema.sql`, the
 * tree-sitter `wasm/` grammars, and (optionally) `parse-worker.js`.
 *
 * When vendored into OXESpace the main bundle is ESM, where `__dirname` is not
 * defined inside imported modules — so the original `__dirname`-relative lookups
 * threw `ReferenceError` and broke schema/grammar loading. The Electron host
 * (CodeGraphService) sets `CODEGRAPH_ASSET_DIR` to `<appPath>/out/main`, where
 * electron-vite copies these assets. Falls back to `__dirname` for the
 * standalone CLI (CommonJS) and `process.cwd()` as a last resort.
 */
export function assetDir(): string {
  if (process.env.CODEGRAPH_ASSET_DIR) return process.env.CODEGRAPH_ASSET_DIR
  // typeof guard avoids a ReferenceError when bundled as ESM (no __dirname).
  return typeof __dirname !== 'undefined' ? __dirname : process.cwd()
}

/** Convenience: join paths under the asset directory. */
export function assetPath(...segments: string[]): string {
  return path.join(assetDir(), ...segments)
}
