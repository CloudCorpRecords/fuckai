import { useState, useEffect, useRef } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

const CAT_COLORS = {
  topics: '#7c6af7',
  concepts: '#a78bfa',
  entities: '#4ade80',
  root: '#888'
}

export default function WikiGraph({ onNodeClick }) {
  const [data, setData] = useState({ nodes: [], links: [] })
  const fgRef = useRef()

  useEffect(() => {
    const load = async () => {
      try {
        const graph = await window.api.getWikiGraph()
        console.log('Graph data received:', graph)
        if (graph && graph.nodes) {
          setData(graph)
          setTimeout(() => {
            fgRef.current?.zoomToFit(400, 100)
            fgRef.current?.d3ReheatSimulation()
          }, 500)
        }
      } catch (e) {
        console.error('Graph load error:', e)
      }
    }
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="wiki-graph-container" style={{ width: '100%', height: '500px', position: 'relative' }}>
      <ForceGraph2D
        ref={fgRef}
        width={360}
        height={500}
        graphData={data}
        backgroundColor="#0a0a0f"
        nodeLabel="title"
        nodeColor={n => CAT_COLORS[n.category] || CAT_COLORS.root}
        nodeRelSize={6}
        linkDirectionalParticles={2}
        linkDirectionalParticleSpeed={0.005}
        linkColor={() => 'rgba(255, 255, 255, 0.2)'}
        onNodeClick={node => onNodeClick?.(node.path)}
        // Simplified node drawing for debugging
        nodeCanvasObject={(node, ctx, globalScale) => {
          const label = node.title
          const fontSize = 12 / globalScale
          
          // Draw circle
          ctx.beginPath()
          ctx.arc(node.x, node.y, 5, 0, 2 * Math.PI, false)
          ctx.fillStyle = CAT_COLORS[node.category] || CAT_COLORS.root
          ctx.fill()

          // Draw label
          if (globalScale > 1.2) {
            ctx.font = `${fontSize}px Sans-Serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillStyle = '#fff'
            ctx.fillText(label, node.x, node.y + 10)
          }
        }}
        nodeCanvasObjectMode={() => 'replace'}
      />
      <div style={{ position: 'absolute', top: 10, left: 10, color: '#667', fontSize: 10, pointerEvents: 'none' }}>
        Nodes: {data.nodes.length} | Links: {data.links.length}
      </div>
    </div>
  )
}
