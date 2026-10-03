import nodemailer from 'nodemailer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emailPattern, required } from './config.mjs';

export function createChannels(c, imessageSend) {
  const preview = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  let smtp;
  function transport() {
    required(c.env, ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM']);
    const port = Number(c.env.SMTP_PORT || 465);
    if (![465, 587].includes(port)) throw new Error('Use SMTP port 465 (TLS) or 587 (STARTTLS).');
    smtp ??= nodemailer.createTransport({ host: c.env.SMTP_HOST, port, secure: port === 465,
      requireTLS: true, auth: { user: c.env.SMTP_USER, pass: c.env.SMTP_PASS },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
      disableFileAccess: true, disableUrlAccess: true });
    return smtp;
  }
  return {
    check(draft) {
      if (draft.mode !== c.mode || draft.from !== c.from) throw new Error('Sending configuration changed. Reject this draft and prepare a new one.');
      if (draft.channel === 'imessage' && (draft.line || '') !== (c.env.IMESSAGE_LINE || '')) throw new Error('iMessage line changed. Prepare a new draft.');
      if (draft.channel === 'linkedin') throw new Error('LinkedIn draft is ready for manual handoff; automated sending is not configured. Nothing sent.');
      if (draft.channel === 'email') {
        if (!emailPattern.test(draft.to) || !emailPattern.test(draft.from)) throw new Error('Use a single plain email address for sender and recipient.');
        if (draft.to !== (c.testTo || draft.lead.address)) throw new Error('Test recipient changed. Prepare a new draft.');
        if (c.mode === 'live') {
          transport();
          if (c.fixture.mock && !c.testTo) throw new Error('Mock leads require EMAIL_TEST_TO before live email sending.');
          if (/@(?:example\.(?:com|org|net)|.*\.invalid)$/i.test(draft.to)) throw new Error('Set a real test inbox; reserved example addresses cannot receive this demo.');
        }
      } else if (c.mode === 'live') {
        if (c.fixture.mock) throw new Error('Live iMessage outreach is disabled for fictional leads. Use real authorized test data.');
        if (!imessageSend) throw new Error('Start Spectrum mode before sending iMessage outreach.');
      }
    },
    async verifyEmail() { await transport().verify(); },
    async send(id, draft) {
      this.check(draft);
      if (draft.channel === 'imessage' && c.mode === 'live') {
        const result = await imessageSend(draft.to, draft.body);
        if (!result?.id) throw new Error('No iMessage acknowledgment received.');
        return { status: 'accepted', providerId: result.id };
      }
      const outbox = join(c.dataDir, 'outbox');
      if (c.mode === 'preview' && draft.channel !== 'email') {
        mkdirSync(outbox, { recursive: true });
        writeFileSync(join(outbox, `${id}.json`), JSON.stringify(draft, null, 2));
        return { status: 'preview', file: `${id}.json` };
      }
      const message = { from: draft.from, to: draft.to, subject: draft.subject, text: draft.body,
        messageId: `<${id}@${draft.from.split('@')[1]}>`, disableFileAccess: true, disableUrlAccess: true };
      const result = await (c.mode === 'preview' ? preview : transport()).sendMail(message);
      if (c.mode === 'preview') {
        mkdirSync(outbox, { recursive: true });
        writeFileSync(join(outbox, `${id}.eml`), result.message);
        return { status: 'preview', file: `${id}.eml` };
      }
      if (!result.accepted?.length || result.rejected?.length) throw new Error('SMTP did not confirm acceptance.');
      return { status: 'accepted', providerId: result.messageId };
    },
  };
}
