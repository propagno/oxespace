// The strip lives in ThreadTabStrip.tsx: on a case-insensitive file system (Windows, macOS) an import of './ThreadTabs'
// resolves to threadTabs.ts, and an import of './threadTabs' by extension order can land here. This file keeps the
// contract names (ThreadTabs, visibleThreadTabs) for whoever loads it by its full path.
export { ThreadTabStrip as ThreadTabs } from './ThreadTabStrip'
export { visibleThreadTabs } from './threadTabs'
