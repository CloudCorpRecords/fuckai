import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'
import WikiPanel from './WikiPanel.jsx'
import ReasoningPanel from './ReasoningPanel.jsx'

// ─── GPU Monitor ─────────────────────────────────────────────────────────────
function GpuBar({ label, value, max, unit, color }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="gpu-bar-item">
      <div className="gpu-bar-header">
        <span className="gpu-bar-label">{label}</span>
        <span className="gpu-bar-value">{isNaN(value) ? '—' : `${value}${unit}`} <span className="gpu-bar-pct">/ {max}{unit}</span></span>
      </div>
      <div className="gpu-bar-track">
        <div className="gpu-bar-fill" style={{ width: `${isNaN(pct) ? 0 : pct}%`, background: color }} />
      </div>
    </div>
  )
}

function StatPill({ label, value }) {
  return (
    <div className="stat-pill">
      <span className="stat-pill-label">{label}</span>
      <span className="stat-pill-value">{value}</span>
    </div>
  )
}

function GpuMonitor({ gpu, backendPid }) {
  if (!gpu) return (
    <div className="gpu-monitor no-gpu"><span>⚡ Waiting for GPU data...</span></div>
  )
  const gpuColor = gpu.gpuUtil > 80 ? '#f87171' : gpu.gpuUtil > 50 ? '#fb923c' : '#7c6af7'
  const vramColor = (gpu.vramUsed / gpu.vramTotal) > 0.85 ? '#f87171' : '#4ade80'
  const powerValid = !isNaN(gpu.powerDraw) && !isNaN(gpu.powerLimit)
  return (
    <div className="gpu-monitor">
      <div className="gpu-monitor-name">
        <span className="gpu-icon">🖥</span>
        <span>{gpu.name}</span>
        {backendPid && <span className="pid-badge">PID {backendPid}</span>}
      </div>
      <div className="gpu-bars">
        <GpuBar label="GPU" value={gpu.gpuUtil} max={100} unit="%" color={gpuColor} />
        <GpuBar label="VRAM" value={Math.round(gpu.vramUsed)} max={Math.round(gpu.vramTotal)} unit="MB" color={vramColor} />
      </div>
      <div className="gpu-pills">
        <StatPill label="Temp" value={`${gpu.temp}°C`} />
        <StatPill label="Power" value={powerValid ? `${Math.round(gpu.powerDraw)}/${Math.round(gpu.powerLimit)}W` : `${Math.round(gpu.powerDraw)}W`} />
        <StatPill label="VRAM" value={`${(gpu.vramUsed/1024).toFixed(1)}/${(gpu.vramTotal/1024).toFixed(1)} GB`} />
      </div>
    </div>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function Message({ msg }) {
  const isAgent = msg.role === 'agent'
  return (
    <div className={`message-row ${isAgent ? 'assistant' : 'user'}`}>
      {isAgent && <div className="avatar">⚡</div>}
      <div className="message">
        {msg.status && (
          <div className="status-msg">
            <span>{msg.status}</span>
          </div>
        )}
        {msg.content && (
          <div className="content">
            {msg.content}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState([{
    id: 'welcome', role: 'agent', status: null,
    content: "Hey! I'm your local AI agent powered by Llama 3.1 on your GPU. I can browse the web, write code, and reason through complex tasks. What can I help you with?"
  }])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [engineStatus, setEngineStatus] = useState('checking')
  const [gpu, setGpu] = useState(null)
  const [backendPid, setBackendPid] = useState(null)
  const [showMonitor, setShowMonitor] = useState(true)
  const [showWiki, setShowWiki] = useState(false)
  const [showReasoning, setShowReasoning] = useState(true)
  const [thoughts, setThoughts] = useState([])
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const api = window.api

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Health polling via IPC
  useEffect(() => {
    const check = async () => {
      if (!api) return
      try {
        const res = await api.healthCheck()
        setEngineStatus(res.online ? 'online' : 'offline')
      } catch {
        setEngineStatus('offline')
      }
    }
    check()
    const interval = setInterval(check, 3000)
    return () => clearInterval(interval)
  }, [api])

  // GPU polling via IPC
  useEffect(() => {
    if (!api) return
    const fetchStats = async () => {
      const [stats, pid] = await Promise.all([api.getGpuStats(), api.getBackendPid()])
      setGpu(stats)
      setBackendPid(pid)
    }
    fetchStats()
    const interval = setInterval(fetchStats, 2000)
    const unsub = api.onBackendEvent?.((ev) => {
      if (ev.type === 'status') setEngineStatus(ev.status)
    })
    return () => { clearInterval(interval); unsub?.() }
  }, [api])

  // Listen to chat chunks from IPC
  useEffect(() => {
    if (!api) return
    const unsub = api.onChatChunk((data) => {
      const { msgId, type, content } = data
      if (type === 'status') {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, status: content } : m))
      } else if (type === 'response') {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content, status: null } : m))
      } else if (type === 'thought') {
        setThoughts(prev => [...prev, content])
      } else if (type === 'done') {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, status: null } : m))
        setIsLoading(false)
        inputRef.current?.focus()
      } else if (type === 'error') {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: `⚠️ ${content}`, status: null } : m))
        setIsLoading(false)
      }
    })
    return unsub
  }, [api])

  const sendMessage = useCallback(() => {
    if (!input.trim() || isLoading) return
    const userMsg = { id: Date.now(), role: 'user', content: input.trim(), status: null }
    const agentMsgId = `agent-${Date.now()}`
    const agentMsg = { id: agentMsgId, role: 'agent', content: '', status: 'Thinking...' }
    setMessages(prev => [...prev, userMsg, agentMsg])
    setThoughts([])
    setInput('')
    setIsLoading(true)

    // Build history payload (only completed messages, no status bubbles)
    const history = messages
      .filter(m => m.content && !m.status)
      .map(m => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.content }))

    api.chatSend(userMsg.content, agentMsgId, history)
  }, [input, isLoading, api, messages])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }
  const statusLabel = { online: 'Engine Online', offline: 'Engine Offline', restarting: 'Restarting...', checking: 'Connecting...' }[engineStatus] ?? 'Connecting...'

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">AgentZero</div>
          <div className="model-tag">Llama 3.1 · Local</div>
        </div>
        <div className="header-right">
          <button className={`monitor-toggle ${showReasoning ? 'active' : ''}`} onClick={() => setShowReasoning(p => !p)} title="Reasoning Sidebar">🧠</button>
          <button className={`monitor-toggle ${showMonitor ? 'active' : ''}`} onClick={() => setShowMonitor(p => !p)} title="GPU Monitor">📊</button>
          <button className={`monitor-toggle ${showWiki ? 'active' : ''}`} onClick={() => setShowWiki(p => !p)} title="Knowledge Wiki">📚</button>
          <div className="status-area">
            <div className={`status-dot ${engineStatus}`} />
            <span className="status-label">{statusLabel}</span>
          </div>
        </div>
      </header>

      {showMonitor && <GpuMonitor gpu={gpu} backendPid={backendPid} />}

      <div className="app-body">
        {showReasoning && <ReasoningPanel thoughts={thoughts} isOpen={true} onClose={() => setShowReasoning(false)} />}
        <div className="messages">
          {messages.map(msg => <Message key={msg.id} msg={msg} />)}
          <div ref={messagesEndRef} />
        </div>
        {showWiki && <WikiPanel onClose={() => setShowWiki(false)} />}
      </div>

      <div className="input-container">
        <div className="input-wrapper">
          <div className="input-area" style={{ flex: 1 }}>
            <input
              ref={inputRef}
              placeholder="Ask anything — I can browse the web and write code..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !isLoading && sendMessage()}
              disabled={isLoading}
            />
          </div>
          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
          >
            {isLoading ? '...' : '↑'}
          </button>
        </div>
        <p className="footer-info">Running locally · 100% private · No cloud APIs</p>
      </div>
    </div>
  )
}
