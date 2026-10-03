import { mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { Spectrum } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { config, required, configurationReport } from './config.mjs';
import { openStore, leadRows } from './store.mjs';
import { createSource } from './sources.mjs';
import { createAI } from './ai.mjs';
import { createChannels } from './channels.mjs';
import { createAgent } from './agent.mjs';

export function organizerInput(space, message, organizers) {
  if (message.platform !== 'imessage' || message.direction !== 'inbound' || space.type !== 'dm') return null;
  if (!message.sender?.id || !organizers.includes(message.sender.id)) return null;
  const content = message.content.type === 'reply' ? message.content.content : message.content;
  if (content.type !== 'text') return null;
  return { text: content.text, context: { actor: message.sender.id,
    conversation: JSON.stringify([space.phone, space.id]), messageId: message.id } };
}

async function main() {
  const c = config();
  if (process.argv.includes('--doctor')) {
    console.log(configurationReport(c));
    const leads = await createSource(c).read();
    console.log(`Lead read verified: ${leads.length} valid records.`);
    if (process.argv.includes('--verify-email')) {
      await createChannels(c).verifyEmail();
      console.log('SMTP authentication verified. No email sent.');
    }
    return;
  }
  const terminal = process.argv.includes('--terminal');
  if (!terminal) required(c.env, ['PROJECT_ID', 'PROJECT_SECRET', 'ORGANIZER_IDS']);
  mkdirSync(c.dataDir, { recursive: true });
  const lockPath = join(c.dataDir, 'agent.lock');
  let lock;
  try { lock = openSync(lockPath, 'wx'); }
  catch { throw new Error('Another agent may be using this data directory. Stop it first. After a crash, confirm no agent is running before removing data/agent.lock.'); }
  let db, app;
  const cleanup = () => { db?.close(); closeSync(lock); unlinkSync(lockPath); };
  process.once('exit', cleanup);
  process.once('SIGINT', () => process.exit(0));
  process.once('SIGTERM', () => process.exit(0));
  db = openStore(c.dataDir);
  // A crash after the provider accepted a message must never trigger an automatic resend.
  db.prepare("UPDATE drafts SET status='uncertain' WHERE status='sending'").run();
  if (!terminal) app = await Spectrum({ projectId: c.env.PROJECT_ID, projectSecret: c.env.PROJECT_SECRET,
    providers: [imessage.config()] });
  const sendIMessage = app ? async (to, text) => {
    const im = imessage(app);
    const user = await im.user(to);
    const space = await im.space.create(user, c.env.IMESSAGE_LINE ? { phone: c.env.IMESSAGE_LINE } : {});
    return space.send(text);
  } : undefined;
  const agent = createAgent({ db, c, source: createSource(c), ai: createAI(c), channels: createChannels(c, sendIMessage) });
  console.log(`Ambassador ready · ${terminal ? 'terminal' : 'Spectrum iMessage'} · outreach ${c.mode} · ${c.env.OPENAI_API_KEY ? 'AI drafting' : 'template drafting'}`);
  if (terminal) {
    console.log('Type help for commands. Type exit to quit. Live sends require iMessage approval.');
    const input = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    // ponytail: one serial command loop; add per-conversation queues if throughput requires it.
    for await (const line of input) {
      if (line.trim() === 'exit') { input.close(); break; }
      console.log(await agent.handle(line, { actor: 'local-organizer', conversation: 'terminal', messageId: randomUUID(), terminal: true }));
      if (process.stdin.isTTY) process.stdout.write('\n> ');
    }
    return;
  }
  for await (const [space, message] of app.messages) {
    const input = organizerInput(space, message, c.organizers);
    if (!input) {
      if (message.direction === 'inbound' && message.content.type === 'text' && space.type === 'dm' &&
          leadRows(db).some(l => l.channel === 'imessage' && l.address === message.sender?.id)) {
        db.prepare('INSERT OR IGNORE INTO replies(id,sender,content,received) VALUES(?,?,?,?)')
          .run(JSON.stringify([space.phone, message.id]), message.sender.id, message.content.text.slice(0,10000), Date.now());
      }
      continue;
    }
    const response = await agent.handle(input.text, input.context);
    if (response) {
      try { await message.reply(response); }
      catch { console.error('Organizer reply failed. Command result is saved; use status or show <draft-id> to retrieve it.'); }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
