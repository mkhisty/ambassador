import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeGraph, graphNeighborhood, layoutKnowledgeGraph } from '../lib/knowledge-graph.mjs';

const contacts = [
  { id:'a', contact:'Alex', company:'Cedar', category:'Technology', channel:'email', owner:'Yash', leadType:'Warm introduction' },
  { id:'b', contact:'Blair', company:' cedar ', category:'Technology', channel:'email', owner:'Yash', notes:'Warm intro discussed; not classified' },
  { id:'c', contact:'Casey', company:'Orbit', category:'Hardware', channel:'imessage', owner:'Taylor' },
];

test('Shared organizations and channels connect different contacts through one hub', () => {
  const graph = buildKnowledgeGraph({ contacts }, ['organization', 'channel']);
  const organization = graph.nodes.filter(node => node.type === 'organization' && node.label.trim().toLowerCase() === 'cedar');
  assert.equal(organization.length, 1);
  assert.deepEqual(graph.edges.filter(edge => edge.target === organization[0].id).map(edge => edge.source), ['contact:a', 'contact:b']);
  assert.equal(graph.nodes.filter(node => node.type === 'channel' && node.label === 'Email').length, 1);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length);
  assert.ok(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.source) && graph.nodes.some(node => node.id === edge.target)));
});

test('Layer toggles leave contacts while removing disabled hub types', () => {
  const graph = buildKnowledgeGraph({ contacts }, ['channel']);
  assert.equal(graph.nodes.filter(node => node.type === 'contact').length, 3);
  assert.ok(graph.nodes.every(node => ['contact', 'channel'].includes(node.type)));
  assert.equal(graph.edges.length, 3);
});

test('Focused hub reveals connected contacts without unrelated records', () => {
  const graph = buildKnowledgeGraph({ contacts });
  const hub = graph.nodes.find(node => node.type === 'channel' && node.label === 'Email');
  const focused = graphNeighborhood(graph, hub.id);
  assert.deepEqual(new Set(focused.nodes.map(node => node.id)), new Set([hub.id, 'contact:a', 'contact:b']));
  assert.equal(focused.edges.length, 2);
  assert.equal(graphNeighborhood(graph, 'deleted:node'), graph);
});

test('Removed roadmap and classification layers never create graph nodes', () => {
  const graph = buildKnowledgeGraph({ contacts, campaign:{name:'Planning'}, activities:[{id:'history', sponsorId:'a'}], documents:[{id:'brief', sponsorId:'a'}] }, ['industry','leadType','campaign','action','document','activity']);
  assert.equal(graph.nodes.length, contacts.length);
  assert.ok(graph.nodes.every(node => node.type === 'contact'));
  assert.equal(graph.edges.length, 0);
});

test('Contact methods form separate clusters with pinned shared hubs', () => {
  const layout = layoutKnowledgeGraph(buildKnowledgeGraph({ contacts }));
  const email = layout.find(node => node.id === 'channel:email');
  const imessage = layout.find(node => node.id === 'channel:imessage');
  assert.equal(imessage.x - email.x, 420);
  const owners = layout.filter(node => node.type === 'owner');
  assert.equal(owners.length, 2);
  assert.ok(owners.every(node => node.y === 220 && node.x > email.x && node.x < imessage.x));
  for (const contact of layout.filter(node => node.type === 'contact')) {
    const own = contact.record.channel === 'email' ? email : imessage;
    const other = own === email ? imessage : email;
    assert.ok(Math.abs(contact.x - own.x) < Math.abs(contact.x - other.x));
  }
});

test('Layout remains finite and repeatable for empty, disconnected, and linked graphs', () => {
  assert.deepEqual(layoutKnowledgeGraph({ nodes:[], edges:[] }), []);
  for (const layers of [[], ['channel', 'organization']]) {
    const graph = buildKnowledgeGraph({ contacts }, layers);
    const result = layoutKnowledgeGraph(graph);
    assert.deepEqual(result, layoutKnowledgeGraph(graph));
    assert.ok(result.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  }
});
