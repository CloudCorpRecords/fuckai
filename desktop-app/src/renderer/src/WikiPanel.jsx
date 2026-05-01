import { useState, useEffect, useCallback } from 'react'
import './WikiPanel.css'
import WikiGraph from './WikiGraph.jsx'

const CAT_ICONS = { entities: '👤', concepts: '🧠', topics: '📚', sessions: '💬', root: '📄' }
const ISSUE_ICONS = { broken_link: '🔗', missing_section: '📋', stale: '🕐', empty_summary: '✏️' }

export default function WikiPanel({ onClose }) {
  const [pages, setPages] = useState([])
  const [stats, setStats] = useState(null)
  const [lintIssues, setLintIssues] = useState([])
  const [selectedPage, setSelectedPage] = useState(null)
  const [pageContent, setPageContent] = useState('')
  const [view, setView] = useState('pages') // 'pages' | 'lint' | 'ingest' | 'global' | 'graph' | 'clip'
  const [globalPages, setGlobalPages] = useState([])
  const [ingestText, setIngestText] = useState('')
  const [ingestName, setIngestName] = useState('')
  const [clipUrl, setClipUrl] = useState('')
  const [isClipping, setIsClipping] = useState(false)
  const [loading, setLoading] = useState(false)
  const [savingSession, setSavingSession] = useState(false)
  const api = window.api

  const loadData = useCallback(async () => {
    if (!api) return
    try {
      const [pagesData, statsData, lintData, globalData] = await Promise.all([
        api.getWikiPages?.(),
        api.getWikiStats?.(),
        api.getWikiLint?.(),
        api.getGlobalPages?.()
      ])
      if (Array.isArray(pagesData)) setPages(pagesData)
      if (statsData) setStats(statsData)
      if (lintData?.issues) setLintIssues(lintData.issues)
      if (Array.isArray(globalData)) setGlobalPages(globalData)
    } catch (e) {
      console.warn('Wiki load error:', e)
    }
  }, [api])

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 10000)
    return () => clearInterval(interval)
  }, [loadData])

  const openPage = async (path) => {
    setSelectedPage(path)
    setPageContent('Loading...')
    try {
      const data = await api.getWikiPage?.(path)
      setPageContent(data?.content || 'Page not found.')
    } catch {
      setPageContent('Error loading page.')
    }
  }

  const importPage = async (path) => {
    setLoading(true)
    try {
      await api.importPage?.(path)
      setView('pages')
      loadData()
    } catch (e) {
      alert('Import failed: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const saveSession = async () => {
    setSavingSession(true)
    try {
      await api.saveSession?.()
      setTimeout(() => { setSavingSession(false); loadData() }, 3000)
    } catch {
      setSavingSession(false)
    }
  }

  // Group pages by category
  const byCategory = {}
  for (const p of pages) {
    if (p.path === 'index') continue
    const cat = p.category || 'root'
    ;(byCategory[cat] = byCategory[cat] || []).push(p)
  }

  const globalByCategory = {}
  for (const p of globalPages) {
    const cat = p.category || 'root'
    ;(globalByCategory[cat] = globalByCategory[cat] || []).push(p)
  }

  const handleClip = async () => {
    if (!clipUrl.trim() || isClipping) return
    setIsClipping(true)
    try {
      const res = await fetch(`http://127.0.0.1:8765/wiki/clip?url=${encodeURIComponent(clipUrl)}`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setClipUrl('')
        setView('pages')
        openPage(data.path)
      } else {
        alert('Clip failed: ' + data.error)
      }
    } catch (e) {
      alert('Error clipping: ' + e.message)
    } finally {
      setIsClipping(false)
    }
  }

  return (
    <div className="wiki-panel">
      {/* Header */}
      <div className="wiki-header">
        <div className="wiki-title">
          <span className="wiki-icon">📚</span>
          <span>Knowledge Wiki</span>
          {stats && (
            <span className="wiki-count">{stats.total_pages} pages</span>
          )}
        </div>
        <div className="wiki-header-actions">
          <button
            className={`wiki-action-btn ${savingSession ? 'saving' : ''}`}
            onClick={saveSession}
            disabled={savingSession}
            title="Save session to wiki"
          >
            {savingSession ? '⏳' : '💾'}
          </button>
          <button className="wiki-action-btn" onClick={loadData} title="Refresh">🔄</button>
          <button className="wiki-close-btn" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="wiki-tabs">
        <button className={`wiki-tab ${view === 'pages' ? 'active' : ''}`} onClick={() => { setView('pages'); setSelectedPage(null) }}>Pages</button>
        <button className={`wiki-tab ${view === 'graph' ? 'active' : ''}`} onClick={() => { setView('graph'); setSelectedPage(null) }}>Graph</button>
        <button className={`wiki-tab ${view === 'clip' ? 'active' : ''}`} onClick={() => setView('clip')}>✂️ Clip</button>
        <button className={`wiki-tab ${view === 'global' ? 'active' : ''}`} onClick={() => { setView('global'); setSelectedPage(null) }}>Shared</button>
        <button className={`wiki-tab ${view === 'lint' ? 'active' : ''}`} onClick={() => setView('lint')}>
          Health {lintIssues.length > 0 && <span className="lint-badge">{lintIssues.length}</span>}
        </button>
        <button className={`wiki-tab ${view === 'ingest' ? 'active' : ''}`} onClick={() => setView('ingest')}>+ Ingest</button>
      </div>

      <div className="wiki-body">
        {/* Clip View */}
        {view === 'clip' && (
          <div className="wiki-ingest">
            <h3 style={{ color: '#fff', fontSize: '14px', marginBottom: '10px' }}>Web Clipper</h3>
            <p style={{ fontSize: '11px', color: '#667', marginBottom: '15px' }}>Enter a URL to distill its content into a clean wiki page.</p>
            <input 
              className="ingest-input"
              placeholder="https://example.com/article"
              value={clipUrl}
              onChange={e => setClipUrl(e.target.value)}
              disabled={isClipping}
            />
            <button 
              className="ingest-btn" 
              onClick={handleClip}
              disabled={isClipping || !clipUrl.trim()}
            >
              {isClipping ? 'Clipping & Distilling...' : 'Clip to Wiki'}
            </button>
          </div>
        )}

        {/* Graph View */}
        {view === 'graph' && (
          <WikiGraph onNodeClick={(path) => { setView('pages'); openPage(path) }} />
        )}

        {/* Pages View */}
        {view === 'pages' && !selectedPage && (
          <div className="wiki-pages">
            {Object.keys(byCategory).length === 0 && (
              <div className="wiki-empty">No local pages yet. Chat with the agent or import from "Shared" knowledge!</div>
            )}
            {Object.entries(byCategory).sort().map(([cat, catPages]) => (
              <div key={cat} className="wiki-category">
                <div className="wiki-category-header">
                  <span>{CAT_ICONS[cat] || '📄'}</span>
                  <span>{cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
                  <span className="wiki-category-count">{catPages.length}</span>
                </div>
                {catPages.map(p => (
                  <button key={p.path} className="wiki-page-row" onClick={() => openPage(p.path)}>
                    <div className="wiki-page-title">{p.title}</div>
                    <div className="wiki-page-summary">{p.summary || 'No summary'}</div>
                    {p.last_compiled && (
                      <div className="wiki-page-date">{p.last_compiled}</div>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Global Library View */}
        {view === 'global' && !selectedPage && (
          <div className="wiki-pages global-lib">
            <div className="global-banner">
              🌎 Community Knowledge Base
              <p>Common concepts and patterns you can pull into your local wiki.</p>
            </div>
            {Object.entries(globalByCategory).sort().map(([cat, catPages]) => (
              <div key={cat} className="wiki-category">
                <div className="wiki-category-header">
                  <span>{CAT_ICONS[cat] || '📄'}</span>
                  <span>{cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
                </div>
                {catPages.map(p => (
                  <div key={p.path} className="wiki-page-row global">
                    <div className="wiki-page-title">{p.title}</div>
                    <div className="wiki-page-summary">{p.summary}</div>
                    <button 
                      className="import-pill" 
                      onClick={() => importPage(p.path)}
                      disabled={loading}
                    >
                      {loading ? '...' : '📥 Pull Local'}
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Page Detail View */}
        {view === 'pages' && selectedPage && (
          <div className="wiki-page-detail">
            <button className="wiki-back-btn" onClick={() => setSelectedPage(null)}>← Back</button>
            <div className="wiki-page-path">{selectedPage}</div>
            <div className="wiki-markdown">
              <MarkdownRenderer content={pageContent} />
            </div>
          </div>
        )}

        {/* Lint View */}
        {view === 'lint' && (
          <div className="wiki-lint">
            {lintIssues.length === 0 ? (
              <div className="wiki-healthy">✅ Wiki is healthy — no issues found</div>
            ) : (
              lintIssues.map((issue, i) => (
                <div key={i} className="wiki-issue">
                  <span className="issue-icon">{ISSUE_ICONS[issue.type] || '⚠️'}</span>
                  <div className="issue-body">
                    <div className="issue-page">{issue.page}</div>
                    <div className="issue-detail">{issue.type.replace(/_/g, ' ')} — {issue.detail}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Ingest View */}
        {view === 'ingest' && (
          <div className="wiki-ingest">
            <p className="ingest-desc">
              Paste any text (article, notes, docs) and the agent will compile it into the wiki.
            </p>
            <input
              className="ingest-name"
              placeholder="Source name (e.g. 'transformers_paper')"
              value={ingestName}
              onChange={e => setIngestName(e.target.value)}
            />
            <textarea
              className="ingest-text"
              placeholder="Paste raw content here..."
              value={ingestText}
              onChange={e => setIngestText(e.target.value)}
              rows={8}
            />
            <button
              className={`ingest-btn ${loading ? 'loading' : ''}`}
              disabled={loading || !ingestText.trim() || !ingestName.trim()}
              onClick={async () => {
                setLoading(true)
                try {
                  // Use fetch directly for form data (multipart not needed — just JSON via IPC)
                  const formData = new FormData()
                  formData.append('source_name', ingestName)
                  formData.append('content', ingestText)
                  const res = await fetch('http://127.0.0.1:8765/wiki/ingest', { method: 'POST', body: formData })
                  const data = await res.json()
                  setIngestText('')
                  setIngestName('')
                  setView('pages')
                  loadData()
                } catch (e) {
                  alert('Ingestion failed: ' + e.message)
                } finally {
                  setLoading(false)
                }
              }}
            >
              {loading ? 'Compiling...' : '⚡ Compile into Wiki'}
            </button>
          </div>
        )}
      </div>

      {/* Stats Footer */}
      {stats && (
        <div className="wiki-footer">
          <span>{stats.total_pages} pages</span>
          <span>·</span>
          <span>{stats.raw_sources} raw sources</span>
          {stats.lint_issues > 0 && <><span>·</span><span className="footer-warning">⚠️ {stats.lint_issues} issues</span></>}
        </div>
      )}
    </div>
  )
}

// Simple markdown renderer (bold, code, headers, bullets)
function MarkdownRenderer({ content }) {
  const lines = (content || '').split('\n')
  return (
    <div className="md-content">
      {lines.map((line, i) => {
        if (line.startsWith('# ')) return <h1 key={i} className="md-h1">{line.slice(2)}</h1>
        if (line.startsWith('## ')) return <h2 key={i} className="md-h2">{line.slice(3)}</h2>
        if (line.startsWith('### ')) return <h3 key={i} className="md-h3">{line.slice(4)}</h3>
        if (line.startsWith('---')) return <hr key={i} className="md-hr" />
        if (line.startsWith('- ') || line.startsWith('* ')) return <div key={i} className="md-li">• {renderInline(line.slice(2))}</div>
        if (line.trim() === '') return <div key={i} className="md-gap" />
        return <p key={i} className="md-p">{renderInline(line)}</p>
      })}
    </div>
  )
}

function renderInline(text) {
  // Replace [[links]], **bold**, `code`
  const parts = []
  const regex = /(\[\[([^\]]+)\]\]|\*\*(.+?)\*\*|`(.+?)`)/g
  let last = 0, m
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[2]) parts.push(<span key={m.index} className="md-link">[[{m[2]}]]</span>)
    else if (m[3]) parts.push(<strong key={m.index}>{m[3]}</strong>)
    else if (m[4]) parts.push(<code key={m.index} className="md-code">{m[4]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
