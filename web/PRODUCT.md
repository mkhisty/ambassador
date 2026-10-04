# Ambassador

Ambassador is a general-purpose outreach campaign planning platform. It can help track party attendees, organize a wedding, coordinate other events, manage recruiter outreach, support startup go-to-market work, or organize political campaign outreach. The common workflow is remembering people and context, deciding the next action, coordinating follow-ups, and making progress visible.

The current demo highlights hackathon sponsorship with 26 fictional sponsor accounts. Sponsor spreadsheets, relationship strategies, follow-ups, proposals, and the sponsorship Sankey demonstrate that broader workflow. Wedding logistics, attendance tracking, recruiter pipelines, startup campaigns, and political campaign tooling are product use cases, not features implemented by this sponsorship POC.

The website is the campaign owner's overview and bulk setup area. Photon Spectrum and iMessage are the intended interface for daily outreach, pitching, negotiation assistance, and calendar work. The website preserves context and makes recorded progress inspectable.

The POC uses Neon Postgres for persistent sponsor records, stage history, event settings, and small private documents. Optional Neon Object Storage supports file bytes. Live messaging synchronization is a separate integration.

## UI direction supplied by the organizer

Remove generic promotional dashboard styling. Use a clear operational interface. The supplied Sankey reference uses broad neutral flows, vertical node bars, direct labels, and selective outcome colors. Preserve uploads, relationship editing, history, and event setup.

## Campaign terminology

Use campaigns, contacts, audiences, outreach, responses, follow-ups, and outcomes throughout the interface. Core metrics count contacts and responses rather than money. Organization is optional for individual contacts. Hackathon sponsorship is one sample campaign, not the product model. Existing database table names, API keys, and stored stage values remain compatible; displayed stages use Ready, Follow-up, and Completed.
