'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { buildKnowledgeGraph, graphNeighborhood, layoutKnowledgeGraph, GRAPH_LAYERS } from '../lib/knowledge-graph.mjs';
import { stageLabel } from '../lib/model.mjs';

const colors = { contact:'#a6cba9', channel:'#d8b582', owner:'#82c8bc', stage:'#9dabcf' };
const typeLabels = { contact:'Contact', channel:'Contact channel', owner:'Product owner', stage:'Stage' };
const fieldLabels = { contact:'Person', company:'Organization', address:'Email / profile', phone:'Phone', channel:'Contact channel', stage:'Stage', owner:'Owner', notes:'Relationship notes', fit:'Reason for outreach', source:'Source', pitch:'Objective', benefits:'Guidelines', amount:'Estimated value', received:'Received' };
const readable = value => typeof value === 'object' ? JSON.stringify(value) : String(value);

export default function KnowledgeGraph({ contacts, onOpenContact }) {
  const [groupBy, setGroupBy] = useState('owner');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [camera, setCamera] = useState({ x:550, y:360, scale:1 });
  const svgRef = useRef(null), interaction = useRef(null);
  const graph = useMemo(() => buildKnowledgeGraph({ contacts }, [groupBy]), [contacts, groupBy]);
  const visible = useMemo(() => graphNeighborhood(graph, focusId), [graph, focusId]);
  const topology = JSON.stringify([groupBy, visible.nodes.map(node => [node.id, node.label]), visible.edges]);
  const layout = useMemo(() => layoutKnowledgeGraph(visible), [topology]);
  const selected = graph.nodes.find(node => node.id === selectedId);
  const positions = new Map(layout.map(node => [node.id, { ...node, ...overrides[node.id] }]));
  const search = query.trim().toLowerCase();
  const matches = graph.nodes.filter(node => (node.label + ' ' + JSON.stringify(node.record || '')).toLowerCase().includes(search));
  const active = new Set();
  const anchors = search ? matches.map(node => node.id) : [hoverId || selectedId].filter(Boolean);
  for (const id of anchors) {
    active.add(id);
    graph.edges.forEach(edge => { if (edge.source === id || edge.target === id) { active.add(edge.source); active.add(edge.target); } });
  }
  const connections = selected ? graph.edges.filter(edge => edge.source === selected.id || edge.target === selected.id).map(edge => ({ edge, node:graph.nodes.find(node => node.id === (edge.source === selected.id ? edge.target : edge.source)) })) : [];

  const fitCamera = (reset = false) => {
    const points = reset ? layout : layout.map(node => overrides[node.id] || node);
    const minX = Math.min(0, ...points.map(node => node.x)), maxX = Math.max(0, ...points.map(node => node.x));
    const minY = Math.min(0, ...points.map(node => node.y)), maxY = Math.max(0, ...points.map(node => node.y));
    const scale = Math.min(2, 1000 / Math.max(300, maxX - minX + 180), 650 / Math.max(300, maxY - minY + 100));
    setCamera({ x:550 - (minX + maxX) / 2 * scale, y:360 - (minY + maxY) / 2 * scale, scale });
  };
  useEffect(() => { setOverrides({}); fitCamera(true); }, [layout]); // Fit after layer/focus changes.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = event => {
      event.preventDefault();
      const bounds = svg.getBoundingClientRect();
      const x = (event.clientX - bounds.left) * 1100 / bounds.width;
      const y = (event.clientY - bounds.top) * 720 / bounds.height;
      setCamera(previous => {
        const scale = Math.max(.15, Math.min(5, previous.scale * Math.exp(-event.deltaY * .0015)));
        const factor = scale / previous.scale;
        return { scale, x:x - (x - previous.x) * factor, y:y - (y - previous.y) * factor };
      });
    };
    svg.addEventListener('wheel', wheel, { passive:false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [contacts.length]);

  function beginPointer(event, node) {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (node) setSelectedId(node.id);
    svgRef.current.setPointerCapture(event.pointerId);
    interaction.current = { node, startX:event.clientX, startY:event.clientY, camera, position:node && positions.get(node.id) };
  }
  function movePointer(event) {
    const drag = interaction.current;
    if (!drag) return;
    const bounds = svgRef.current.getBoundingClientRect();
    const dx = (event.clientX - drag.startX) * 1100 / bounds.width;
    const dy = (event.clientY - drag.startY) * 720 / bounds.height;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.node) setOverrides(previous => ({ ...previous, [drag.node.id]:{ x:drag.position.x + dx / drag.camera.scale, y:drag.position.y + dy / drag.camera.scale } }));
    else setCamera({ ...drag.camera, x:drag.camera.x + dx, y:drag.camera.y + dy });
  }
  function endPointer() {
    if (interaction.current && !interaction.current.node && !interaction.current.moved) setSelectedId(null);
    interaction.current = null;
  }
  const zoom = factor => setCamera(previous => ({ ...previous, scale:Math.max(.15, Math.min(5, previous.scale * factor)) }));

  if (!contacts.length) return <section className="panel graph-empty"><h2>Your shared network starts here</h2><p>Add contacts to explore product owners, contact methods, and stages.</p></section>;

  return <div className="network-workspace">
    <section className="network-controls panel">
      <label className="search-box"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} aria-label="Search knowledge graph" placeholder="Search people, sponsors, notes…"/></label>
      <div className="network-grouping" role="radiogroup" aria-label="Group relationships by">
        <span className="network-grouping-slider" aria-hidden="true" style={{ left:(Math.max(0, GRAPH_LAYERS.findIndex(([type]) => type === groupBy)) * 100 / GRAPH_LAYERS.length) + '%' }}/>
        {GRAPH_LAYERS.map(([type, label]) => <label key={type} className={groupBy === type ? 'active' : ''}>
          <input type="radio" name="graph-grouping" checked={groupBy === type} onChange={() => { setGroupBy(type); setSelectedId(null); setFocusId(null); }}/><span>{label}</span>
        </label>)}
      </div>
    </section>
    <div className={'network-content ' + (!selected && !search ? 'network-content-wide' : '')}>
      <section className="network-map">
        <div className="network-map-heading"><div><strong>{focusId ? 'Focused neighborhood' : 'Shared outreach network'}</strong><span>{visible.nodes.length} nodes · {visible.edges.length} connections</span></div><div className="network-map-actions">{focusId && <button onClick={() => { setFocusId(null); setSelectedId(null); }}>Full network</button>}<button onClick={() => zoom(1.25)} aria-label="Zoom in"><ZoomIn size={17}/></button><button onClick={() => zoom(.8)} aria-label="Zoom out"><ZoomOut size={17}/></button><button onClick={() => fitCamera()} aria-label="Fit graph"><Maximize2 size={17}/></button></div></div>
        <svg ref={svgRef} viewBox="0 0 1100 720" className="network-svg" role="group" aria-label="Interactive outreach knowledge graph" onPointerDown={event => beginPointer(event, null)} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={() => { interaction.current = null; }}>
          <title>Sponsors grouped by product owner, contact method, or stage</title>
          <g transform={'translate(' + camera.x + ' ' + camera.y + ') scale(' + camera.scale + ')'}>
            {layout.filter(node => node.type === groupBy).map(node => {
              const position = positions.get(node.id);
              return <circle key={'ring:' + node.id} className="network-orbit" cx={position.x} cy={position.y} r="112"/>;
            })}
            {visible.edges.map(edge => {
              const a = positions.get(edge.source), b = positions.get(edge.target);
              const lit = active.size && active.has(edge.source) && active.has(edge.target);
              return <line key={edge.source + ':' + edge.target} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={lit ? 'network-edge lit' : 'network-edge'} opacity={active.size && !lit ? .12 : 1}><title>{a.label + ' — ' + edge.relation + ' — ' + b.label}</title></line>;
            })}
            {layout.map(node => {
              const position = positions.get(node.id);
              const radius = node.type === 'contact' ? 7 : 24;
              return <g key={node.id} className={'network-node ' + (selectedId === node.id ? 'selected' : '')} transform={'translate(' + position.x + ' ' + position.y + ')'} opacity={active.size && !active.has(node.id) ? .18 : 1} tabIndex={0} role="button" aria-label={typeLabels[node.type] + ': ' + node.label} onPointerDown={event => beginPointer(event, node)} onMouseEnter={() => setHoverId(node.id)} onMouseLeave={() => setHoverId(null)} onDoubleClick={() => { setSelectedId(node.id); setFocusId(node.id); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(node.id); } }}>
                <circle r={radius + 8} className="network-hit"/><circle r={radius} fill={colors[node.type]}/><text y={radius + 18} textAnchor="middle" visibility={node.type !== 'contact' || selectedId === node.id ? 'visible' : 'hidden'}>{node.label.length > 30 ? node.label.slice(0, 29) + '…' : node.label}</text><title>{typeLabels[node.type] + ': ' + node.label}</title>
              </g>;
            })}
          </g>
        </svg>
        <div className="network-hint">Drag nodes to arrange · Drag background to pan · Scroll to zoom · Double-click to focus</div>
      </section>
      {(selected || search) && <aside className="network-inspector panel">
        {search && <div className="network-search-results"><h3>{matches.length} search results</h3>{matches.slice(0, 40).map(node => <button key={node.id} onClick={() => { setSelectedId(node.id); setFocusId(node.id); }}><i style={{ background:colors[node.type] }}/><span>{node.label}<small>{typeLabels[node.type]}</small></span></button>)}{matches.length > 40 && <small>Narrow your search to see more results.</small>}</div>}
        {selected ? <>
          <span className="network-kind" style={{ color:colors[selected.type] }}>{typeLabels[selected.type]}</span><h2>{selected.label}</h2>
          <div className="network-detail-actions"><button className="button secondary" onClick={() => setFocusId(selected.id)}>Focus this node</button>{selected.type === 'contact' && onOpenContact && <button className="text-button" onClick={() => onOpenContact(selected.record)}>Edit contact</button>}</div>
          <h3>Connections ({connections.length})</h3><div className="network-connections">{connections.map(({ edge, node }) => <button key={node.id} onClick={() => setSelectedId(node.id)}><i style={{ background:colors[node.type] }}/><span>{node.label}<small>{edge.relation}</small></span></button>)}</div>
          {selected.record && <><h3>Saved context</h3><dl className="network-facts">{Object.entries(selected.record).filter(([key, value]) => ['contact', 'company', 'address', 'phone', 'channel', 'owner', 'stage', 'notes', 'fit', 'source'].includes(key) && value != null && value !== '').map(([key, value]) => <div key={key}><dt>{fieldLabels[key] || key.replace(/[A-Z]/g, letter => ' ' + letter.toLowerCase())}</dt><dd>{key === 'stage' ? stageLabel(value) : readable(value)}</dd></div>)}</dl></>}
        </> : null}
      </aside>}
    </div>
  </div>;
}
