import { OAuth2Client } from 'google-auth-library';

const verifier = new OAuth2Client();
const invalid = message => Object.assign(new Error(message), { status:400 });

export function notificationData(envelope, expectedSubscription) {
  if (!expectedSubscription) throw Object.assign(new Error('Configure GMAIL_PUBSUB_SUBSCRIPTION.'), {status:503});
  if (envelope?.subscription !== expectedSubscription) throw invalid('Unexpected subscription.');
  const encoded = envelope?.message?.data;
  if (typeof encoded !== 'string' || encoded.length > 10000 || !/^[\w+/=-]+$/.test(encoded)) throw invalid('Invalid notification.');
  let data;
  try { data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
  catch { throw invalid('Invalid notification.'); }
  if (typeof data?.emailAddress !== 'string' || data.emailAddress.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(data.emailAddress) || !/^[0-9]{1,30}$/.test(String(data.historyId))) throw invalid('Invalid notification.');
  return {emailAddress:data.emailAddress.toLowerCase(), historyId:String(data.historyId)};
}

export async function verifyPush(request, env=process.env, client=verifier) {
  if (!env.GMAIL_PUSH_AUDIENCE || !env.GMAIL_PUSH_SERVICE_ACCOUNT) throw Object.assign(new Error('Configure Gmail push authentication.'), {status:503});
  const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '');
  if (!match) throw Object.assign(new Error('Google authentication required.'), {status:401});
  let payload;
  try {
    const ticket = await client.verifyIdToken({idToken:match[1], audience:env.GMAIL_PUSH_AUDIENCE});
    payload = ticket.getPayload();
  } catch { throw Object.assign(new Error('Invalid Google authentication.'), {status:401}); }
  if (payload?.email !== env.GMAIL_PUSH_SERVICE_ACCOUNT || payload.email_verified !== true) throw Object.assign(new Error('Unexpected Google identity.'), {status:403});
}

export function notificationHandler({verify=verifyPush, save, env=process.env}) {
  return async request => {
    try {
      await verify(request);
      const raw=await request.text();
      if (Buffer.byteLength(raw)>20000) return Response.json({error:'Request too large.'},{status:413});
      const data=notificationData(JSON.parse(raw),env.GMAIL_PUBSUB_SUBSCRIPTION);
      await save(data);
      return new Response(null,{status:204});
    } catch(error) {
      // Never echo notification contents, OAuth tokens, or database failures.
      const status=error instanceof SyntaxError?400:error.status||503;
      return Response.json({error:status===503?'Gmail notifications unavailable.':'Invalid Gmail notification.'},{status});
    }
  };
}
