import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // Health
  healthCheck: () => ipcRenderer.invoke('health-check'),

  // GPU
  getGpuStats: () => ipcRenderer.invoke('get-gpu-stats'),
  getBackendPid: () => ipcRenderer.invoke('get-backend-pid'),

  // Chat (streaming via IPC events)
  chatSend: (message, msgId, history = []) => ipcRenderer.send('chat-send', { message, msgId, history }),
  onChatChunk: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('chat-chunk', handler)
    return () => ipcRenderer.removeListener('chat-chunk', handler)
  },

  // Wiki
  getWikiPages: () => ipcRenderer.invoke('wiki-pages'),
  getWikiStats: () => ipcRenderer.invoke('wiki-stats'),
  getWikiLint: () => ipcRenderer.invoke('wiki-lint'),
  getWikiPage: (path) => ipcRenderer.invoke('wiki-page', path),
  saveSession: () => ipcRenderer.invoke('wiki-save-session'),
  getGlobalPages: () => ipcRenderer.invoke('wiki-global'),
  importPage: (path) => ipcRenderer.invoke('wiki-import', path),

  // Backend lifecycle events
  onBackendEvent: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('backend-event', handler)
    return () => ipcRenderer.removeListener('backend-event', handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
