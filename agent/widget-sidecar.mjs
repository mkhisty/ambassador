// Use the Spectrum SDK already installed by Hermes; leave that installation untouched.
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createReviewCards } from './review-card.mjs';

const require = createRequire(process.env.PHOTON_SDK_SIDECAR);
const { Spectrum, app: miniApp } = await import(pathToFileURL(require.resolve('spectrum-ts')));
const { imessage } = await import(pathToFileURL(require.resolve('spectrum-ts/providers/imessage')));
const token = process.env.PHOTON_SIDECAR_TOKEN;
if (!token) throw new Error('Missing sidecar token');
const spectrum = await Spectrum({
  projectId: process.env.PHOTON_PROJECT_ID,
  projectSecret: process.env.PHOTON_PROJECT_SECRET,
  providers: [imessage.config()], telemetry: false,
});
const spaces = new Map();
const streams = new Set();
const backlog = [];
const cards = createReviewCards(miniApp);
let streamFailure;
const server = http.createServer(async (req, res) => {
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.headers['x-hermes-sidecar-token'] !== token) return json(401, { ok: false });
  if (req.method === 'GET' && req.url === '/inbound') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.flushHeaders();
    for (const event of backlog.splice(0)) res.write(event);
    streams.add(res);
    res.on('close', () => streams.delete(res));
    return;
  }
  if (req.method !== 'POST') return json(405, { ok: false });
  if (req.url === '/healthz') return json(streamFailure ? 503 : 200, { ok: !streamFailure });
  if (!['/send-app', '/update-app'].includes(req.url)) return json(404, { ok: false });
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 16384) return json(413, { ok: false });
    }
    const { spaceId, url, reviewId, action, kind } = JSON.parse(raw);
    if (typeof reviewId !== 'string' || !reviewId) throw new Error('Review ID required');
    if (req.url === '/update-app') {
      await cards.update(reviewId, action);
      return json(200, { ok: true });
    }
    if (typeof url !== 'string' || new URL(url).protocol !== 'https:') throw new Error('HTTPS widget URL required');
    const space = spaces.get(spaceId);
    if (!space) throw new Error('No inbound conversation for this card');
    // A normal app card opens the widget in a sheet when tapped, instead of
    // squeezing the controls into the transcript's inline bubble.
    const sent = await cards.send(space, reviewId, url, kind);
    json(200, { ok: true, messageId: sent?.id });
  } catch (error) {
    json(400, { ok: false, error: error.message });
  }
});
server.listen(Number(process.env.PHOTON_SIDECAR_PORT || 8791), '127.0.0.1');
try {
  for await (const [space, message] of spectrum.messages) {
    if (message.direction !== 'inbound' || space.type !== 'dm') continue;
    let content = message.content;
    if (content.type === 'reply') content = content.content;
    if (content.type !== 'text') continue;
    spaces.set(space.id, space);
    const event = JSON.stringify({ messageId: message.id,
      space: { id: space.id, type: space.type, phone: space.phone },
      sender: { id: message.sender?.id }, content: { type: 'text', text: content.text },
    }) + '\n';
    if (streams.size) for (const stream of streams) stream.write(event);
    else {
      backlog.push(event);
      if (backlog.length > 100) backlog.shift();
    }
  }
  throw new Error('Photon inbound stream closed');
} catch (error) {
  streamFailure = error;
  console.error(error.message);
  for (const stream of streams) stream.end();
  server.close(() => process.exit(1));
}
