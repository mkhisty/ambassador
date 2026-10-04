# web

Campaigns, contacts, documents, and Google account linking. Next.js + Neon + a private S3 bucket.

Needs Node.js 24+. Copy `.env.example` to `.env.local` and fill in the database, login, and bucket settings.

From this folder:

```sh
npm install
npm run db:migrate
npm run dev
```

Open http://127.0.0.1:3000. Import contacts from Documents. Link Google under Connected apps.

Deploy on Vercel with `web` as the root directory and the same env settings.
