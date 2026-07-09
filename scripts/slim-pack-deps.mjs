/**
 * Strip packaging dead weight before electron-builder runs.
 *
 * Semantic search uses ONLY Xenova/multilingual-e5-small from
 * resources/models (extraResources). The transformers.js download cache under
 * node_modules often still holds leftover models from older experiments
 * (all-MiniLM-L6-v2, multilingual-e5-base) — those must never ship.
 *
 * onnxruntime-node ships prebuilds for every OS; OXESpace Windows x64 only
 * needs win32/x64.
 *
 * Safe to re-run; missing paths are ignored. Does not touch resources/models.
 *
 * Usage: node scripts/slim-pack-deps.mjs
 */

import { existsSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function dirSizeMb(path) {
  if (!existsSync(path)) return 0
  let total = 0
  const walk = (p) => {
    for (const ent of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, ent.name)
      if (ent.isDirectory()) walk(full)
      else total += statSync(full).size
    }
  }
  try { walk(path) } catch { /* ignore */ }
  return total / (1024 * 1024)
}

function remove(rel, reason) {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) {
    console.log(`  skip  ${rel} (absent)`)
    return
  }
  const before = dirSizeMb(abs)
  rmSync(abs, { recursive: true, force: true })
  console.log(`  drop  ${rel}  (−${before.toFixed(1)} MB)  — ${reason}`)
}

console.log('slim-pack-deps: stripping unused packaging weight…')

// 1) transformers.js HuggingFace cache (dev leftovers, not the offline bundle)
remove(
  'node_modules/@xenova/transformers/.cache',
  'unused MiniLM / e5-base cache; app uses resources/models/e5-small'
)

// 2) ONNX Runtime — keep only win32-x64 for this Windows product
const onnxNapi = 'node_modules/onnxruntime-node/bin/napi-v3'
for (const platform of ['darwin', 'linux']) {
  remove(`${onnxNapi}/${platform}`, `ONNX ${platform} not needed on Windows x64`)
}
remove(`${onnxNapi}/win32/arm64`, 'ONNX win32-arm64 not needed on x64 builds')

console.log('slim-pack-deps: done.')
