CREATE TABLE IF NOT EXISTS ambassador_gmail_watches (
  phone_number text PRIMARY KEY REFERENCES ambassador_google_connections(phone_number) ON UPDATE CASCADE ON DELETE CASCADE,
  google_email text NOT NULL,
  history_id numeric(30,0),
  notified_history_id numeric(30,0) NOT NULL DEFAULT 0,
  watch_expires_at timestamptz,
  renewed_at timestamptz,
  synced_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  sync_token uuid,
  sync_until timestamptz,
  recovery_page text,
  recovery_history_id numeric(30,0)
);
CREATE TABLE IF NOT EXISTS ambassador_gmail_inbox (
  phone_number text NOT NULL REFERENCES ambassador_gmail_watches(phone_number) ON UPDATE CASCADE ON DELETE CASCADE,
  message_id text NOT NULL,
  data jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (phone_number,message_id)
);
CREATE INDEX IF NOT EXISTS ambassador_gmail_inbox_pending ON ambassador_gmail_inbox(status,created_at);
