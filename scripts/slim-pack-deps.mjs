/**
 * Strip packaging dead weight before electron-builder runs.
 *
 * Semantic search uses ONLY Xenova/multilingual-e5-base from
 * resources/models (extraResources). The transformers.js download cache under
 * node_modules often still holds leftover models from older experiments
 * (all-MiniLM-L6-v2, multilingual-e5-small) — those must never ship.
 *
 * onnxruntime-node ships prebuilds for every OS; a build only needs the one
 * matching its target. This is the ONLY place that prunes them — electron-builder
 * `files` filters cannot vary by target, so a hardcoded filter there would strip
 * the binaries a Linux build needs and break semantic search silently.
 *
 * Safe to re-run; missing paths are ignored. Does not touch resources/models.
 *
 * Usage: node scripts/slim-pack-deps.mjs [--platform=linux] [--arch=x64]
 *        (both default to the host)
 */

import { existsSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function argValue(name, fallback) {
  const match = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
  return match ? match.slice(name.length + 3) : fallback
}

const TARGET_PLATFORM = argValue('platform', process.platform)
const TARGET_ARCH = argValue('arch', process.arch)

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

console.log(`slim-pack-deps: stripping unused packaging weight for ${TARGET_PLATFORM}-${TARGET_ARCH}…`)

// 1) transformers.js HuggingFace cache (dev leftovers, not the offline bundle)
remove(
  'node_modules/@xenova/transformers/.cache',
  'unused MiniLM / e5-small cache; app uses resources/models/e5-base'
)

// 2) ONNX Runtime — keep only the prebuild matching the build target.
// Derived from the target rather than hardcoded, so a Linux build keeps its own
// binaries instead of deleting them.
const onnxNapi = 'node_modules/onnxruntime-node/bin/napi-v3'
if (existsSync(join(ROOT, onnxNapi))) {
  for (const platform of readdirSync(join(ROOT, onnxNapi))) {
    if (platform !== TARGET_PLATFORM) {
      remove(`${onnxNapi}/${platform}`, `ONNX ${platform} not needed for a ${TARGET_PLATFORM} build`)
      continue
    }
    // Same platform, other architectures.
    const platformDir = join(ROOT, onnxNapi, platform)
    for (const arch of readdirSync(platformDir)) {
      if (arch !== TARGET_ARCH) {
        remove(`${onnxNapi}/${platform}/${arch}`, `ONNX ${platform}-${arch} not needed for a ${TARGET_ARCH} build`)
      }
    }
  }
} else {
  console.log(`  skip  ${onnxNapi} (absent)`)
}

console.log('slim-pack-deps: done.')
