CREATE TABLE IF NOT EXISTS ambassador_event (
  id text PRIMARY KEY CHECK (id = 'main'),
  data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS ambassador_sponsors (
  id text PRIMARY KEY,
  duplicate_key text NOT NULL UNIQUE,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ambassador_users (
  phone_number text PRIMARY KEY CHECK (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ambassador_user_auth (
  phone_number text PRIMARY KEY REFERENCES ambassador_users(phone_number) ON UPDATE CASCADE ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ambassador_user_companies (
  phone_number text NOT NULL REFERENCES ambassador_users(phone_number) ON UPDATE CASCADE ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES ambassador_sponsors(id) ON DELETE CASCADE,
  PRIMARY KEY (phone_number, company_id)
);
CREATE INDEX IF NOT EXISTS ambassador_user_company_lookup ON ambassador_user_companies(company_id);
CREATE TABLE IF NOT EXISTS ambassador_activities (
  id text PRIMARY KEY,
  sponsor_id text REFERENCES ambassador_sponsors(id),
  owner_phone_number text REFERENCES ambassador_users(phone_number) ON UPDATE CASCADE ON DELETE CASCADE,
  kind text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ambassador_activities ADD COLUMN IF NOT EXISTS owner_phone_number text REFERENCES ambassador_users(phone_number) ON UPDATE CASCADE ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ambassador_activity_time ON ambassador_activities(created_at DESC);
CREATE INDEX IF NOT EXISTS ambassador_activity_owner ON ambassador_activities(owner_phone_number,created_at DESC);
CREATE TABLE IF NOT EXISTS ambassador_documents (
  id text PRIMARY KEY,
  name text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL CHECK (size > 0),
  sponsor_id text REFERENCES ambassador_sponsors(id),
  object_key text,
  content bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((object_key IS NOT NULL AND content IS NULL) OR (object_key IS NULL AND content IS NOT NULL))
);
ALTER TABLE ambassador_documents ADD COLUMN IF NOT EXISTS owner_phone_number text REFERENCES ambassador_users(phone_number) ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS ambassador_document_owner ON ambassador_documents(owner_phone_number,created_at DESC);
CREATE TABLE IF NOT EXISTS ambassador_google_oauth_states (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  phone_number text NOT NULL REFERENCES ambassador_users(phone_number) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ambassador_google_oauth_state_expiry ON ambassador_google_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS ambassador_google_connections (
  phone_number text PRIMARY KEY REFERENCES ambassador_users(phone_number) ON DELETE CASCADE,
  google_subject text NOT NULL,
  google_email text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  refresh_token_ciphertext text NOT NULL,
  refresh_token_iv text NOT NULL,
  refresh_token_tag text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ambassador_outreach_drafts (
  id text PRIMARY KEY,
  owner_phone_number text NOT NULL REFERENCES ambassador_users(phone_number) ON DELETE CASCADE,
  sponsor_id text REFERENCES ambassador_sponsors(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL,
  reply_to text NOT NULL DEFAULT '',
  review_id text,
  cc jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cc) = 'array'),
  bcc jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(bcc) = 'array'),
  attachment_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachment_refs) = 'array'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','sending','send_unknown','failed','sent')),
  google_draft_id text,
  google_message_id text,
  send_error text,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ambassador_outreach_drafts ADD COLUMN IF NOT EXISTS review_id text;
ALTER TABLE ambassador_outreach_drafts ALTER COLUMN sponsor_id DROP NOT NULL;
ALTER TABLE ambassador_outreach_drafts ADD COLUMN IF NOT EXISTS cc jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ambassador_outreach_drafts ADD COLUMN IF NOT EXISTS bcc jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ambassador_outreach_drafts ADD COLUMN IF NOT EXISTS attachment_refs jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ambassador_outreach_drafts ADD COLUMN IF NOT EXISTS reply_to text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS ambassador_outreach_review_id ON ambassador_outreach_drafts(owner_phone_number,review_id) WHERE review_id IS NOT NULL;
ALTER TABLE ambassador_outreach_drafts DROP CONSTRAINT IF EXISTS ambassador_outreach_drafts_status_check;
ALTER TABLE ambassador_outreach_drafts ADD CONSTRAINT ambassador_outreach_drafts_status_check CHECK (status IN ('draft','approved','rejected','sending','send_unknown','failed','sent'));
ALTER TABLE ambassador_outreach_drafts ADD COLUMN IF NOT EXISTS google_message_id text;
ALTER TABLE ambassador_outreach_drafts ADD COLUMN IF NOT EXISTS send_error text;
ALTER TABLE ambassador_outreach_drafts ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE ambassador_outreach_drafts ADD COLUMN IF NOT EXISTS sent_at timestamptz;
DROP INDEX IF EXISTS ambassador_outreach_one_open_draft;
CREATE UNIQUE INDEX ambassador_outreach_one_open_draft ON ambassador_outreach_drafts(owner_phone_number,sponsor_id) WHERE status='draft' AND review_id IS NULL;

ALTER TABLE ambassador_documents DROP CONSTRAINT IF EXISTS ambassador_documents_size_check;
ALTER TABLE ambassador_documents ALTER COLUMN size TYPE bigint;
ALTER TABLE ambassador_documents ADD CONSTRAINT ambassador_documents_size_check CHECK (size > 0);
