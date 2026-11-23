/**
 * OXE-358 · what data-export.ipc.ts loads with await import() on first use: the run of the one-time export of the
 * removed features' data, its state and its notice marker. index.ts reads only peekDatabaseVersion at boot, straight
 * from removed-features-export.ts; nothing here runs at boot. The exporter itself stays in removed-features-export.ts
 * (the R0b, R5, R8 and R14 checks read it there), so this module adds no second copy and no second state: the last
 * error of a run lives in that one module.
 */
export {
  exportRemovedFeatures,
  latestRemovedFeaturesExport,
  markRemovedFeaturesNoticeShown,
  removedFeaturesState
} from './removed-features-export'
