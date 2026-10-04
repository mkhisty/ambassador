import { database } from '../../../../../lib/db.mjs';
import { notificationHandler } from '../../../../../lib/gmail-notifications.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export const POST=notificationHandler({save:async ({emailAddress,historyId}) => {
  const sql=database();
  // Coalesce duplicate/out-of-order events; cursor advances only after fetching.
  await sql`UPDATE ambassador_gmail_watches w SET notified_history_id=GREATEST(w.notified_history_id,${historyId}::numeric)
    FROM ambassador_google_connections c WHERE c.phone_number=w.phone_number
    AND lower(c.google_email)=${emailAddress} AND lower(w.google_email)=${emailAddress}`;
}});
