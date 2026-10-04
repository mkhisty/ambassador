import { normalizePhone, safeEqual } from './auth.mjs';
import { database } from './db.mjs';
import { documentsForPhone, documentForOwner } from './documents.mjs';
import { readObject, downloadUrl } from './files.mjs';

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export function agentAuthorized(request) {
  const token = process.env.AGENT_API_TOKEN;
  return (token?.length || 0) >= 32 && safeEqual(request.headers.get('authorization'), `Bearer ${token}`);
}

export async function contextForPhone(phoneNumber) {
  const phone = normalizePhone(phoneNumber), sql = database();
  const [user] = await sql`SELECT phone_number,name,email,details FROM ambassador_users WHERE phone_number=${phone}`;
  if (!user) return null;
  const [campaign, contacts, activities, documents] = await Promise.all([
    sql`SELECT data FROM ambassador_event WHERE id='main'`,
    sql`SELECT s.id,s.data FROM ambassador_sponsors s JOIN ambassador_user_companies c ON c.company_id=s.id WHERE c.phone_number=${phone} ORDER BY s.id`,
    sql`SELECT DISTINCT a.id,a.sponsor_id,a.kind,a.data,a.created_at FROM ambassador_activities a LEFT JOIN ambassador_user_companies c ON c.company_id=a.sponsor_id WHERE a.owner_phone_number=${phone} OR c.phone_number=${phone} ORDER BY a.created_at DESC`,
    documentsForPhone(phone,{downloadLinks:true}),
  ]);
  return {
    phoneNumber: phone,
    user: { phoneNumber: phone, name: user.name, email: user.email, details: user.details },
    campaign: campaign[0]?.data || null,
    contacts: contacts.map(row => ({ ...row.data, id: row.id })),
    activities: activities.map(row => ({ ...row.data, id: row.id, sponsorId: row.sponsor_id, kind: row.kind, at: new Date(row.created_at).toISOString() })),
    documents,
  };
}

export function createContextHandlers({ readContext = contextForPhone, readDocument = documentForOwner, readStoredObject = readObject, signDownload = downloadUrl } = {}) {
  const error = (message, status) => Response.json({ error: message }, { status, headers: privateHeaders });
  function owner(request) {
    if (!agentAuthorized(request)) return error('Agent authentication required.', 401);
    try { return normalizePhone(new URL(request.url).searchParams.get('phoneNumber')); }
    catch { return error('A valid phoneNumber is required.', 400); }
  }
  return {
    async manifest(request) {
      const phone = owner(request); if (phone instanceof Response) return phone;
      try {
        const context = await readContext(phone);
        return context ? Response.json(context, { headers: privateHeaders }) : error('Account not found.', 404);
      } catch (failure) {
        console.error('Agent context read failed:', failure.code || failure.name);
        return error('Could not load account context.', 503);
      }
    },
    async document(request, { params }) {
      const phone = owner(request); if (phone instanceof Response) return phone;
      try {
        const { id } = await params;
        if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) return error('Document not found.', 404);
        const file = await readDocument(id, phone);
        if (!file) return error('Document not found.', 404);
        if(file.object_key&&new URL(request.url).searchParams.get('download')==='link')return Response.json({downloadUrl:await signDownload(file.object_key,file.name)},{headers:privateHeaders});
        const bytes = file.object_key ? await readStoredObject(file.object_key) : Buffer.from(file.content, 'base64');
        return new Response(bytes, { headers: {
          ...privateHeaders, 'Content-Type': file.mime,
          'Content-Length': String(bytes.length),
          'Content-Disposition': `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        } });
      } catch (failure) {
        console.error('Agent document read failed:', failure.code || failure.name);
        return error('Could not download account document.', 503);
      }
    },
  };
}
