import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join, resolve } from 'path'
import { spawn } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import http from 'http'
import icon from '../../resources/icon.png?asset'

// ─── Config ───────────────────────────────────────────────────────────────────
const BACKEND_PORT = 8765
const BACKEND_HOST = '127.0.0.1'

// ─── Backend Process ──────────────────────────────────────────────────────────
let backendProcess = null
let backendRestarting = false

function getBackendPath() {
  if (is.dev) {
    return resolve(__dirname, '../../..', 'backend', 'main.py')
  }
  return join(process.resourcesPath, 'backend', 'main.py')
}

function spawnBackend() {
  if (backendRestarting) return
  const backendPath = getBackendPath()
  console.log('[AgentZero] Spawning backend:', backendPath)
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
  backendProcess = spawn(pythonCmd, [backendPath], { stdio: ['ignore', 'pipe', 'pipe'], detached: false })
  backendProcess.stdout.on('data', d => process.stdout.write(`[py] ${d}`))
  backendProcess.stderr.on('data', d => process.stdout.write(`[py] ${d}`))
  backendProcess.on('exit', (code) => {
    console.log(`[AgentZero] Backend exited (${code}). Restarting in 2s...`)
    backendProcess = null
    backendRestarting = true
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('backend-event', { type: 'status', status: 'restarting' }))
    setTimeout(() => { backendRestarting = false; spawnBackend() }, 2000)
  })
  backendProcess.on('error', e => console.error('[AgentZero] Backend spawn error:', e.message))
}

function killBackend() {
  if (backendProcess) {
    backendProcess.removeAllListeners('exit')
    backendProcess.kill('SIGTERM')
    backendProcess = null
  }
}

// ─── HTTP helpers (main-process-side, no CORS) ────────────────────────────────
function httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: BACKEND_HOST, port: BACKEND_PORT, path, timeout: 3000 }, (res) => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(data) } })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function httpPostJson(path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body)
    const req = http.request({
      host: BACKEND_HOST, port: BACKEND_PORT, path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 10000
    }, (res) => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(data) } })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(bodyStr)
    req.end()
  })
}

function httpPostStream(path, body, onChunk, onDone) {
  const bodyStr = JSON.stringify(body)
  const req = http.request({
    host: BACKEND_HOST, port: BACKEND_PORT, path,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
  }, (res) => {
    let buffer = ''
    res.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() // keep incomplete last line
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            onChunk(data)
          } catch { /* ignore */ }
        }
      }
    })
    res.on('end', onDone)
  })
  req.on('error', (e) => onChunk({ type: 'error', content: e.message }))
  req.write(bodyStr)
  req.end()
}

// ─── GPU Stats ────────────────────────────────────────────────────────────────
function getGpuStats() {
  return new Promise((resolve) => {
    const proc = spawn('nvidia-smi', [
      '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit',
      '--format=csv,noheader,nounits'
    ])
    let out = ''
    proc.stdout.on('data', d => { out += d })
    proc.on('close', () => {
      try {
        const p = out.trim().split(',').map(s => s.trim())
        resolve({ name: p[0], gpuUtil: +p[1], vramUsed: +p[2], vramTotal: +p[3], temp: +p[4], powerDraw: +p[5], powerLimit: +p[6] })
      } catch { resolve(null) }
    })
    proc.on('error', () => resolve(null))
  })
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('health-check', async () => {
  try { return { online: true, ...(await httpGet('/health')) } }
  catch { return { online: false } }
})

ipcMain.handle('get-gpu-stats', async () => getGpuStats())
ipcMain.handle('get-backend-pid', () => backendProcess?.pid ?? null)

// Wiki IPC handlers
ipcMain.handle('wiki-pages', async () => { try { return await httpGet('/wiki/pages') } catch { return [] } })
ipcMain.handle('wiki-stats', async () => { try { return await httpGet('/wiki/stats') } catch { return null } })
ipcMain.handle('wiki-lint', async () => { try { return await httpGet('/wiki/lint') } catch { return { issues: [] } } })
ipcMain.handle('wiki-page', async (_, path) => { try { return await httpGet(`/wiki/page?path=${encodeURIComponent(path)}`) } catch { return null } })
ipcMain.handle('wiki-save-session', async () => { try { return await httpPostJson('/wiki/save-session', {}) } catch { return null } })
ipcMain.handle('wiki-global', async () => { try { return await httpGet('/wiki/global') } catch { return [] } })
ipcMain.handle('wiki-import', async (_, path) => { try { return await httpPostJson(`/wiki/import?path=${encodeURIComponent(path)}`, {}) } catch { return null } })
ipcMain.handle('wiki-graph', async () => { try { return await httpGet('/wiki/graph') } catch { return { nodes: [], links: [] } } })

// Streaming chat via IPC — sends chunks back as events
ipcMain.on('chat-send', (event, { message, msgId, history = [] }) => {
  httpPostStream('/chat', { message, history }, (data) => {
    event.sender.send('chat-chunk', { ...data, msgId })
  }, () => {
    event.sender.send('chat-chunk', { type: 'done', msgId })
  })
})

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1000, height: 720, minWidth: 720, minHeight: 500,
    show: false, autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0c0c0f', symbolColor: '#8888aa', height: 44 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

// ─── App Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.agentzero')
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))
  spawnBackend()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { killBackend(); if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', killBackend)
