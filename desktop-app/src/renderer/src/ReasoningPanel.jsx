import React, { useEffect, useRef } from 'react'
import './ReasoningPanel.css'

export default function ReasoningPanel({ thoughts, isOpen, onClose }) {
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thoughts])

  if (!isOpen) return null

  return (
    <div className="reasoning-sidebar">
      <div className="reasoning-header">
        <div className="reasoning-title">
          <span className="reasoning-icon">🧠</span>
          Agent Reasoning
        </div>
        <button className="close-sidebar" onClick={onClose}>×</button>
      </div>

      <div className="reasoning-steps">
        {thoughts.map((thought, i) => (
          <div key={i} className="thought-step animate-in">
            <div className="thought-dot"></div>
            <div className="thought-content">
              <div className="thought-time">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
              <div className="thought-text">{thought}</div>
            </div>
          </div>
        ))}
        {thoughts.length === 0 && (
          <div className="reasoning-empty">
            <div className="empty-brain">🧊</div>
            <p>Waiting for the agent to start thinking...</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="reasoning-footer">
        <div className="status-badge">
          <div className="pulse"></div>
          Monitoring Thought Stream
        </div>
      </div>
    </div>
  )
}
