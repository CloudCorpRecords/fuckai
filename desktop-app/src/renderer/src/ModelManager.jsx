import React, { useState, useEffect } from 'react'
import './ModelManager.css'

const POPULAR_MODELS = [
  { name: 'llama3.1:8b',    label: 'Llama 3.1 8B',       desc: 'Best all-around. Fast, smart, great for chat & code.', size: '4.7 GB', tag: '⭐ Recommended', family: 'Meta' },
  { name: 'llama3.1:70b',   label: 'Llama 3.1 70B',      desc: 'Most capable Llama. Slower but highly intelligent.', size: '40 GB', tag: '🧠 Most Capable', family: 'Meta' },
  { name: 'mistral:7b',     label: 'Mistral 7B',          desc: 'Blazing fast, very efficient. Great for quick answers.', size: '4.1 GB', tag: '⚡ Fastest', family: 'Mistral' },
  { name: 'gemma2:9b',      label: 'Gemma 2 9B',          desc: "Google's latest. Excellent reasoning and instruction following.", size: '5.5 GB', tag: '🔬 Google', family: 'Google' },
  { name: 'phi3:mini',      label: 'Phi-3 Mini',          desc: "Microsoft's tiny but mighty model. Runs on minimal VRAM.", size: '2.3 GB', tag: '💡 Tiny', family: 'Microsoft' },
  { name: 'phi3:medium',    label: 'Phi-3 Medium',        desc: "Microsoft's larger Phi-3. Punches above its weight class.", size: '7.9 GB', tag: '🎯 Balanced', family: 'Microsoft' },
  { name: 'codellama:7b',   label: 'Code Llama 7B',       desc: 'Specialized for code generation, debugging, and review.', size: '3.8 GB', tag: '💻 Coding', family: 'Meta' },
  { name: 'deepseek-coder:6.7b', label: 'DeepSeek Coder', desc: 'Top coding model. Exceptional at complex code tasks.', size: '3.8 GB', tag: '💻 Coding', family: 'DeepSeek' },
  { name: 'qwen2.5:7b',     label: 'Qwen 2.5 7B',        desc: 'Multilingual powerhouse. Excellent in English & Chinese.', size: '4.4 GB', tag: '🌍 Multilingual', family: 'Alibaba' },
  { name: 'llava:7b',       label: 'LLaVA 7B',            desc: 'Vision + language model. Can understand images.', size: '4.7 GB', tag: '👁 Vision', family: 'Various' },
  { name: 'neural-chat:7b', label: 'Neural Chat 7B',      desc: "Intel's chat-optimized model. Great conversation flow.", size: '4.1 GB', tag: '💬 Chat', family: 'Intel' },
  { name: 'orca-mini:3b',   label: 'Orca Mini 3B',        desc: 'Tiny model for low-end hardware. Surprisingly capable.', size: '1.9 GB', tag: '🪶 Ultra-Light', family: 'Various' },
]

export default function ModelManager({ isOpen, onClose, currentModel, onModelSwitched }) {
  const [models, setModels] = useState([])
  const [pullName, setPullName] = useState('')
  const [pullStatus, setPullStatus] = useState(null)
  const [isPulling, setIsPulling] = useState(false)
  const [pullingModel, setPullingModel] = useState(null)
  const [tab, setTab] = useState('installed') // 'installed' | 'browse'
  const [search, setSearch] = useState('')
  const api = window.api

  useEffect(() => {
    if (isOpen && api) loadModels()
  }, [isOpen, api])

  useEffect(() => {
    if (!api) return
    const unsub = api.onModelsPullChunk((data) => {
      if (data.status === 'done' || data.error) {
        setIsPulling(false)
        setPullingModel(null)
        if (data.error) setPullStatus(`❌ Error: ${data.error}`)
        else { setPullStatus('✅ Pull complete! Model is ready.'); loadModels(); setPullName('') }
      } else {
        let msg = data.status || 'Downloading...'
        if (data.completed && data.total) {
          const pct = Math.round((data.completed / data.total) * 100)
          const mb = (data.completed / 1024 / 1024).toFixed(0)
          const totalMb = (data.total / 1024 / 1024).toFixed(0)
          msg = `${data.status || 'Pulling'} — ${pct}% (${mb} / ${totalMb} MB)`
        }
        setPullStatus(msg)
      }
    })
    return unsub
  }, [api])

  const loadModels = async () => {
    try {
      const res = await api.getModelsList()
      if (res && res.models) setModels(res.models)
    } catch (e) { console.error('Failed to load models:', e) }
  }

  const handleSwitch = async (name) => {
    try {
      const res = await api.switchModel(name)
      if (res && res.status === 'switched') { onModelSwitched(res.model); onClose() }
    } catch (e) { console.error('Failed to switch model:', e) }
  }

  const startPull = (name) => {
    if (isPulling) return
    setPullingModel(name)
    setIsPulling(true)
    setPullStatus('Starting download...')
    api.pullModel(name)
    setTab('installed')
  }

  const handleManualPull = () => {
    if (!pullName.trim() || isPulling) return
    startPull(pullName.trim())
  }

  const installedNames = new Set(models.map(m => m.name))
  const filteredCatalog = POPULAR_MODELS.filter(m =>
    search === '' || m.label.toLowerCase().includes(search.toLowerCase()) ||
    m.desc.toLowerCase().includes(search.toLowerCase()) ||
    m.family.toLowerCase().includes(search.toLowerCase())
  )

  if (!isOpen) return null

  return (
    <div className="model-modal-overlay" onClick={onClose}>
      <div className="model-modal" onClick={e => e.stopPropagation()}>
        <div className="model-header">
          <h3>🤖 Model Manager</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="model-tabs">
          <button className={`mtab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>
            Installed {models.length > 0 && <span className="mtab-badge">{models.length}</span>}
          </button>
          <button className={`mtab ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>
            Browse Catalog
          </button>
          <button className={`mtab ${tab === 'custom' ? 'active' : ''}`} onClick={() => setTab('custom')}>
            Custom Pull
          </button>
        </div>

        <div className="model-body">

          {/* ── INSTALLED TAB ── */}
          {tab === 'installed' && (
            <div className="model-section">
              {isPulling && (
                <div className="pull-progress-box">
                  <div className="pull-progress-label">⬇ Downloading: <strong>{pullingModel}</strong></div>
                  <div className="pull-status active">{pullStatus}</div>
                  <div className="pull-bar-track"><div className="pull-bar-fill" /></div>
                </div>
              )}
              <div className="model-list">
                {models.length === 0 ? (
                  <div className="empty-state">
                    <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
                    <div>No models found. Browse the catalog to install one!</div>
                  </div>
                ) : models.map(m => {
                  const isActive = m.name === currentModel || m.name === `${currentModel}:latest`
                  return (
                    <div key={m.name} className={`model-item ${isActive ? 'active' : ''}`}>
                      <div className="model-info">
                        <span className="model-name">{m.name}</span>
                        <span className="model-size">{m.details?.parameter_size || '?'} · {(m.size / 1024 / 1024 / 1024).toFixed(1)} GB</span>
                      </div>
                      <button
                        className={`model-btn ${isActive ? 'active-btn' : ''}`}
                        onClick={() => !isActive && handleSwitch(m.name)}
                        disabled={isActive}
                      >
                        {isActive ? '✓ Active' : 'Use'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── BROWSE TAB ── */}
          {tab === 'browse' && (
            <div className="model-section">
              <input
                className="catalog-search"
                placeholder="🔍  Search models..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <div className="catalog-list">
                {filteredCatalog.map(m => {
                  const installed = installedNames.has(m.name) || installedNames.has(`${m.name}:latest`)
                  const isPullingThis = isPulling && pullingModel === m.name
                  return (
                    <div key={m.name} className="catalog-item">
                      <div className="catalog-top">
                        <div>
                          <span className="catalog-label">{m.label}</span>
                          <span className="catalog-family">{m.family}</span>
                        </div>
                        <span className="catalog-tag">{m.tag}</span>
                      </div>
                      <div className="catalog-desc">{m.desc}</div>
                      <div className="catalog-bottom">
                        <span className="catalog-size">💾 {m.size}</span>
                        {installed ? (
                          <button className="catalog-btn installed" onClick={() => handleSwitch(m.name)}>
                            ✓ Use Model
                          </button>
                        ) : isPullingThis ? (
                          <button className="catalog-btn pulling" disabled>Downloading...</button>
                        ) : (
                          <button className="catalog-btn" onClick={() => startPull(m.name)} disabled={isPulling}>
                            ⬇ Install
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── CUSTOM PULL TAB ── */}
          {tab === 'custom' && (
            <div className="model-section">
              <h4>Pull from Ollama Registry</h4>
              <p className="model-help">
                Enter any model name from <a href="https://ollama.com/library" target="_blank" rel="noreferrer" className="ollama-link">ollama.com/library</a> (e.g. <code>mistral</code>, <code>gemma</code>, <code>llama3.1:8b</code>)
              </p>
              <div className="pull-input-group">
                <input
                  type="text"
                  placeholder="e.g. mistral, gemma2:9b, phi3..."
                  value={pullName}
                  onChange={e => setPullName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleManualPull()}
                  disabled={isPulling}
                />
                <button onClick={handleManualPull} disabled={!pullName.trim() || isPulling} className={isPulling ? 'pulling' : ''}>
                  {isPulling ? 'Pulling...' : '⬇ Pull'}
                </button>
              </div>
              {pullStatus && (
                <div className={`pull-status ${pullStatus.startsWith('✅') ? 'done' : pullStatus.startsWith('❌') ? 'error' : 'active'}`}>
                  {pullStatus}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
