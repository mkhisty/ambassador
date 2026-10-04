'use client';
import { useMemo, useState } from 'react';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { flowData } from '../lib/model.mjs';

const colors = { Completed: '#598c77', Declined: '#c68b6a' };

export default function Pipeline({ contacts }) {
  const [hover, setHover] = useState(null);
  const graph = useMemo(() => {
    const data = flowData(contacts);
    if (!data.links.length) return null;
    return sankey().nodeId(node => node.id).nodeWidth(12).nodePadding(22)
      .nodeSort((a, b) => a.order - b.order).nodeAlign(node => node.column)
      .extent([[155, 18], [780, 360]])(data);
  }, [contacts]);
  if (!graph) return <div className="chart-empty"><strong>No contacts yet</strong><span>Import a spreadsheet or add a contact to start your pipeline.</span></div>;
  return <><p className="chart-mobile-hint">Scroll horizontally to view all stages.</p><div className="sankey-wrap">
    <svg viewBox="0 0 1000 405" role="img" aria-labelledby="pipeline-title pipeline-description">
      <title id="pipeline-title">Outreach pipeline by outreach channel and current stage</title>
      <desc id="pipeline-description">{contacts.length} contacts. Band width represents contact count. This chart shows current distribution, not historical conversion rates.</desc>
      {graph.links.map((link, index) => {
        const active = hover === null || link.source.id === hover || link.target.id === hover;
        return <path key={index} d={sankeyLinkHorizontal()(link)} fill="none" stroke={colors[link.target.label] || '#c6c8c4'}
          strokeWidth={link.width} opacity={active ? .85 : .2}
          onMouseEnter={() => setHover(link.target.id)} onMouseLeave={() => setHover(null)}>
          <title>{link.source.label} to {link.target.label}: {link.value} contacts</title>
        </path>;
      })}
      {graph.nodes.map(node => {
        const middle = (node.y0 + node.y1) / 2;
        return <g key={node.id} onMouseEnter={() => setHover(node.id)} onMouseLeave={() => setHover(null)}>
          <rect x={node.x0} y={node.y0} width={12} height={node.y1 - node.y0} fill={colors[node.label] || '#8c9089'} />
          {node.column === 1 ? <g className="chart-center-label">
            <rect x={node.x0 - 65} y={middle - 24} width={142} height={48} rx={3} fill="white" />
            <text x={node.x0 + 6} y={middle - 2} textAnchor="middle">Contacts</text>
            <text x={node.x0 + 6} y={middle + 17} textAnchor="middle" className="chart-value">{node.value}</text>
          </g> : <text x={node.column === 0 ? node.x0 - 14 : node.x1 + 14} y={middle + 5}
            textAnchor={node.column === 0 ? 'end' : 'start'} className="chart-label">
            {node.label}<tspan dx={8} className="chart-value">{node.value}</tspan>
          </text>}
          <title>{node.label}: {node.value} contacts</title>
        </g>;
      })}
      <text x="155" y="397" textAnchor="middle" className="chart-axis">Outreach channel</text>
      <text x="473" y="397" textAnchor="middle" className="chart-axis">All contacts</text>
      <text x="780" y="397" textAnchor="middle" className="chart-axis">Current stage</text>
    </svg>
    <p className="chart-foot">Current distribution · band width represents contact count</p>
    <table className="sr-only"><caption>Contacts by current stage</caption><thead><tr><th>Stage</th><th>Contacts</th></tr></thead><tbody>{graph.nodes.filter(n=>n.column===2).map(n=><tr key={n.id}><td>{n.label}</td><td>{n.value}</td></tr>)}</tbody></table>
  </div></>;
}
