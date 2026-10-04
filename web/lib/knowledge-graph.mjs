import { stageLabel } from './model.mjs';

export const GRAPH_LAYERS = [
  ['owner', 'Product owners'], ['channel', 'Contact methods'], ['stage', 'Stages'],
];
export const DEFAULT_GRAPH_LAYERS = ['owner'];
const sharedId = (type, value) => type + ':' + encodeURIComponent(String(value).trim().toLowerCase());

export function buildKnowledgeGraph({ contacts = [] }, layers = DEFAULT_GRAPH_LAYERS) {
  const enabled = new Set(layers), nodes = new Map(), edges = [];
  const add = (id, type, label, record) => {
    if (!nodes.has(id)) nodes.set(id, { id, type, label, record });
    return id;
  };
  const link = (source, target, relation) => edges.push({ source, target, relation });
  for (const contact of contacts) {
    const id = add('contact:' + contact.id, 'contact', contact.company || contact.contact || 'Contact', contact);
    const attributes = [
      ['channel', contact.channel, 'contact via'],
      ['owner', contact.owner || (enabled.has('owner') ? 'Unassigned' : ''), 'owned by'], ['stage', contact.stage, 'current stage'],
    ];
    for (const [type, value, relation] of attributes) {
      if (!value || !enabled.has(type)) continue;
      const label = type === 'stage' ? stageLabel(value) : type === 'channel' ? ({email:'Email', imessage:'iMessage', linkedin:'LinkedIn'}[value] || value) : value;
      link(id, add(sharedId(type, value), type, label), relation);
    }
  }
  return { nodes: [...nodes.values()], edges };
}

export function graphNeighborhood(graph, id) {
  if (!id || !graph.nodes.some(node => node.id === id)) return graph;
  const edges = graph.edges.filter(edge => edge.source === id || edge.target === id);
  const ids = new Set([id, ...edges.flatMap(edge => [edge.source, edge.target])]);
  return { nodes: graph.nodes.filter(node => ids.has(node.id)), edges };
}

export function layoutKnowledgeGraph(graph) {
  const groupType = ['owner', 'channel', 'stage'].find(type => graph.nodes.some(node => node.type === type)) || 'owner';
  const field = groupType;
  const channels = [...new Set(graph.nodes.filter(node => node.type === 'contact').map(node => String(node.record?.[field] || '').trim().toLowerCase()))].sort();
  const columns = channels.length >= 6 ? 4 : Math.ceil(Math.sqrt(channels.length));
  const rows = Math.ceil(channels.length / columns);
  const centers = new Map(channels.map((channel, index) => {
    const row = Math.floor(index / columns), rowLength = Math.min(columns, channels.length - row * columns);
    const column = index % columns;
    return [channel, { x:(column - (rowLength - 1) / 2) * 280, y:(row - (rows - 1) / 2) * 280 }];
  }));
  const groupSizes = new Map();
  for (const node of graph.nodes) if (node.type === 'contact') {
    const group = String(node.record?.[field] || '').trim().toLowerCase();
    groupSizes.set(group, (groupSizes.get(group) || 0) + 1);
  }
  const owners = graph.nodes.filter(node => node.type === 'owner');
  const counts = new Map();
  const nodes = graph.nodes.map((node, index) => {
    const channel = node.type === groupType ? decodeURIComponent(node.id.slice(groupType.length + 1)) : String(node.record?.[field] || '').trim().toLowerCase();
    const center = node.type === 'owner' && groupType !== 'owner' ? { x:(owners.findIndex(owner => owner.id === node.id) - (owners.length - 1) / 2) * 120, y:220 } : centers.get(channel);
    const groupIndex = counts.get(channel) || 0;
    if (node.type === 'contact') counts.set(channel, groupIndex + 1);
    const angle = center ? groupIndex * Math.PI * 2 / (groupSizes.get(channel) || 1) : index * 2.399963;
    const radius = node.type === groupType ? 0 : 84;
    return { ...node, x:(center?.x || 0) + Math.cos(angle) * radius, y:(center?.y || 0) + Math.sin(angle) * radius, anchor:center };
  });
  return nodes;
}
