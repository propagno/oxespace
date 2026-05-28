import { contextBridge, ipcRenderer } from 'electron'
import { createOxeApi } from './api'

// Default EventEmitter cap is 10. Each TerminalView subscribes to `terminal:data`
// + `terminal:exit`, plus the renderer keeps visited workspaces mounted, so the
// cap is reached as soon as the user opens ~5 panes. Bumping to 100 covers the
// realistic upper bound (multi-workspace, multi-pane layouts) and silences the
// MaxListenersExceededWarning that was masquerading as a leak.
ipcRenderer.setMaxListeners(100)

contextBridge.exposeInMainWorld('oxe', createOxeApi(ipcRenderer))
