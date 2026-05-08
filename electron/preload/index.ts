import { contextBridge, ipcRenderer } from 'electron'
import { createOxeApi } from './api'

contextBridge.exposeInMainWorld('oxe', createOxeApi(ipcRenderer))
