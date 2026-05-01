import React, { useState, useEffect } from 'react'
import './ModelManager.css'

export default function ModelManager({ isOpen, onClose, currentModel, onModelSwitched }) {
  const [models, setModels] = useState([])
  const [pullName, setPullName] = useState('')
  const [pullStatus, setPullStatus] = useState(null)
  const [isPulling, setIsPulling] = useState(false)
  const api = window.api

  useEffect(() => {
    if (isOpen && api) {
      loadModels()
    }
  }, [isOpen, api])

  // Listen for pull chunks
  useEffect(() => {
    if (!api) return
    const unsub = api.onModelsPullChunk((data) => {
      if (data.status === 'done' || data.error) {
        setIsPulling(false)
        if (data.error) setPullStatus(`Error: ${data.error}`)
        else {
          setPullStatus('Pull complete!')
          loadModels()
          setPullName('')
        }
      } else {
        let msg = data.status || 'Downloading...'
        if (data.completed && data.total) {
          const pct = Math.round((data.completed / data.total) * 100)
          msg += ` (${pct}%)`
        }
        setPullStatus(msg)
      }
    })
    return unsub
  }, [api])

  const loadModels = async () => {
    try {
      const res = await api.getModelsList()
      if (res && res.models) {
        setModels(res.models)
      }
    } catch (e) {
      console.error('Failed to load models:', e)
    }
  }

  const handleSwitch = async (name) => {
    try {
      const res = await api.switchModel(name)
      if (res && res.status === 'switched') {
        onModelSwitched(res.model)
        onClose()
      }
    } catch (e) {
      console.error('Failed to switch model:', e)
    }
  }

  const handlePull = () => {
    if (!pullName.trim() || isPulling) return
    setIsPulling(true)
    setPullStatus('Starting pull...')
    api.pullModel(pullName.trim())
  }

  if (!isOpen) return null

  return (
    <div className="model-modal-overlay" onClick={onClose}>
      <div className="model-modal" onClick={e => e.stopPropagation()}>
        <div className="model-header">
          <h3>Model Manager</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="model-body">
          <div className="model-section">
            <h4>Installed Local Models</h4>
            <div className="model-list">
              {models.length === 0 ? (
                <div className="empty-state">No models found in Ollama.</div>
              ) : (
                models.map(m => {
                  const isActive = m.name === currentModel
                  return (
                    <div key={m.name} className={`model-item ${isActive ? 'active' : ''}`}>
                      <div className="model-info">
                        <span className="model-name">{m.name}</span>
                        <span className="model-size">{m.details?.parameter_size || 'Unknown'} · {(m.size / 1024 / 1024 / 1024).toFixed(1)} GB</span>
                      </div>
                      <button 
                        className={`model-btn ${isActive ? 'active-btn' : ''}`}
                        onClick={() => !isActive && handleSwitch(m.name)}
                        disabled={isActive}
                      >
                        {isActive ? 'Active' : 'Select'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="model-section">
            <h4>Pull New Model</h4>
            <p className="model-help">Enter a model name from the Ollama library (e.g. <code>mistral</code>, <code>gemma</code>, <code>llama3.1:8b</code>)</p>
            <div className="pull-input-group">
              <input 
                type="text" 
                placeholder="Model name..." 
                value={pullName}
                onChange={e => setPullName(e.target.value)}
                disabled={isPulling}
              />
              <button 
                onClick={handlePull} 
                disabled={!pullName.trim() || isPulling}
                className={isPulling ? 'pulling' : ''}
              >
                {isPulling ? 'Pulling...' : '⬇ Pull'}
              </button>
            </div>
            {pullStatus && (
              <div className="pull-status">
                {pullStatus}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
