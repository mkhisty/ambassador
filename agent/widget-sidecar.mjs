// Use the Spectrum SDK already installed by Hermes; leave that installation untouched.
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createReviewCards } from './review-card.mjs';
import { acknowledgeMessage } from './message-receipts.mjs';

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
const im = imessage(spectrum);
const spaces = new Map();
const streams = new Set();
const backlog = [];
const cards = createReviewCards(miniApp);
const sends = new Map();
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
  if (!['/send-app', '/update-app', '/send-message'].includes(req.url)) return json(404, { ok: false });
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 128 * 1024) return json(413, { ok: false });
    }
    const { spaceId, url, reviewId, action, kind, text, recipientPhone, organizerPhone } = JSON.parse(raw);
    if (typeof reviewId !== 'string' || !reviewId) throw new Error('Review ID required');
    if (req.url === '/send-message') {
      if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw new Error('Message text required');
      if (sends.has(reviewId)) {
        const prior = await sends.get(reviewId);
        return json(200, { ok: true, messageId: prior.messageId, duplicate: true });
      }
      let space;
      if (recipientPhone) {
        if (!/^\+[1-9]\d{7,14}$/.test(recipientPhone)) throw new Error('Recipient phone must use E.164 format');
        space = [...spaces.values()].find(candidate => candidate.phone === recipientPhone);
        if (!space) {
          const user = await im.user(recipientPhone);
          space = await im.space.create(user);
        }
      } else {
        space = spaces.get(spaceId);
        if (!space && spaceId) space = await im.space.get(spaceId);
      }
      if (!space) throw new Error('Photon conversation unavailable for recipient');
      // Cache promise before provider call so concurrent retries cannot double-send.
      const sending = Promise.resolve().then(async () => {
        const sent = await space.send(text);
        if (!sent?.id) throw new Error('Photon returned no outbound message ID; delivery may be uncertain');
        return { messageId: sent.id };
      });
      sends.set(reviewId, sending);
      const result = await sending;
      return json(200, { ok: true, ...result });
    }
    if (req.url === '/update-app') {
      await cards.update(reviewId, action);
      return json(200, { ok: true });
    }
    if (typeof url !== 'string' || new URL(url).protocol !== 'https:') throw new Error('HTTPS widget URL required');
    let space;
    if (organizerPhone && /^\+[1-9]\d{7,14}$/.test(organizerPhone)) {
      space = [...spaces.values()].find(candidate => candidate.phone === organizerPhone);
      if (!space && spaceId) {
        space = spaces.get(spaceId);
        if (!space) space = await im.space.get(spaceId);
      }
      if (!space) {
        try { space = await im.space.get(`any;-;${organizerPhone}`); } catch {}
      }
      if (!space) space = await im.space.create(await im.user(organizerPhone));
    } else {
      space = spaces.get(spaceId);
      if (!space && spaceId) space = await im.space.get(spaceId);
    }
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
    if (space.type !== 'dm') continue;
    await acknowledgeMessage(message);
    let content = message.content;
    if (content.type === 'reply') content = content.content;
    if (content.type !== 'text') continue;
    spaces.set(space.id, space);
    if (message.direction !== 'inbound') continue;
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
