# Sponsorship Relationship Strategy

Ambassador coordinates events, people, and outreach: from party attendance and weddings to recruiter outreach, startup go-to-market work, and political campaigns. This demo focuses on hackathon sponsorship. Other use cases are product directions, not implemented modules in this POC.

This mock dataset contains 26 fictional prospective sponsor accounts, including committed and declined outcomes. Companies, contacts, phone numbers, relationships, payment records, and histories are invented. Example.com URLs are placeholders, not verified lead sources. Never contact these records as real prospects.

## Dataset and workflow

The source of truth is web/lib/demo.mjs. Run npm run demo:export from web to regenerate the sponsor CSV, messaging fixtures, and this guide. Browser demo dates are relative to today; exported walkthrough dates use October 3, 2026 and an event on November 14, 2026. The dashboard displays current distribution by channel and stage, not historical conversion rates.

| Stage | Accounts |
| --- | --- |
| Identified | 4 |
| Qualified | 5 |
| Contacted | 4 |
| Replied | 3 |
| Negotiating | 3 |
| Committed | 5 |
| Declined | 2 |

Mock committed funding: $17,500; received: $8,500; goal: $25,000. These figures are scenario data, not real payments.

## Relationship rules

Use verified conversation history and event fit to choose an approach. Separate observations from interpretations and record confidence. Ask directly when the blocker is unclear; silence does not establish interest or rejection.

For each opportunity, record the objective, evidence, likely blocker, next question, fallback, approved limits, and follow-up date. Never invent audience numbers, competing offers, deadlines, prior promises, or authority. Do not promise exclusivity, discounts, custom benefits, or deliverables outside organizer-approved terms. Every live message requires approval of its exact draft.

Identified accounts need contact research. Qualified accounts may receive a first pitch after approval. Contacted accounts need a measured follow-up, not another initial pitch. Replied accounts need answers to specific questions. Negotiating accounts need bounded terms and organizer review. Committed accounts need fulfillment and payment tracking. Declined accounts should not receive repeated pitches. The offline worker maps only Qualified to ready and Negotiating to contract_review.

## Acquiring real leads

Replace placeholder sources with verified official partnership pages, previous event sponsor lists, campus/alumni introductions, relevant company student programs, and local business directories. Record the actual source URL, permission for a warm introduction, the decision owner, and an evidence-backed reason for fit. Verify email or phone before drafting; a profile phone number is not proof of ownership or permission to contact.

## Fictional account strategies

### Northstar Cloud — Committed

- Contact: Jamie Rivera; email; partner1@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $6,000; received in scenario: $4,000.
- Mock evidence and approach: Fictional scenario: Offer accepted. Student developer credits plus cash sponsorship.
- Fit to verify: Developer tools partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Confirm logo assets. Follow-up: 2026-10-07.
- Placeholder lead source: https://example.com/mock-leads/northstar-cloud
- Fallback: Resolve fulfillment or payment timing; do not reopen pricing without organizer review.

### Cedar Labs — Negotiating

- Contact: Jordan Ellis; imessage; +12025550102. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $4,000; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Warm introduction from alumni network. Interested in recruiting and a mentor session.
- Fit to verify: Technology partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Share updated sponsorship package. Follow-up: 2026-10-03.
- Placeholder lead source: https://example.com/mock-leads/cedar-labs
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Lantern Design — Replied

- Contact: Taylor Chen; linkedin; https://example.com/mock-linkedin/contact-3. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $2,500; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Previously sponsored a design jam. Prefers a short pitch with participant demographics.
- Fit to verify: Design partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Send audience breakdown. Follow-up: 2026-10-04.
- Placeholder lead source: https://example.com/mock-leads/lantern-design
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Orbit Hardware — Committed

- Contact: Sam Patel; email; partner4@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $3,500; received in scenario: $2,000.
- Mock evidence and approach: Fictional scenario: Returning partner. Confirmed hardware prizes and cash support.
- Fit to verify: Hardware partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Arrange prize delivery. Follow-up: 2026-10-08.
- Placeholder lead source: https://example.com/mock-leads/orbit-hardware
- Fallback: Resolve fulfillment or payment timing; do not reopen pricing without organizer review.

### Meridian Finance — Contacted

- Contact: Avery Kim; email; partner5@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $3,000; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Community programs team supports student entrepreneurship. Introduction via faculty.
- Fit to verify: Finance partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Follow up on initial pitch. Follow-up: 2026-10-02.
- Placeholder lead source: https://example.com/mock-leads/meridian-finance
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Juniper Foods — Qualified

- Contact: Morgan Lee; imessage; +12025550106. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $1,500; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Local catering partner with a student discount program.
- Fit to verify: Food & beverage partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Draft food sponsorship proposal. Follow-up: 2026-10-05.
- Placeholder lead source: https://example.com/mock-leads/juniper-foods
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Atlas Systems — Contacted

- Contact: Alex Chen; linkedin; https://example.com/mock-linkedin/contact-7. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $5,000; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Public university partnerships page. Strong interest in open-source education.
- Fit to verify: Technology partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Check in with partnerships team. Follow-up: 2026-10-01.
- Placeholder lead source: https://example.com/mock-leads/atlas-systems
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Bloom Studio — Identified

- Contact: Riley Brooks; email; partner8@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $1,000; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Discovered through a past event sponsor page. Contact still needs verification.
- Fit to verify: Design partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Research partnership contact. Follow-up: 2026-10-06.
- Placeholder lead source: https://example.com/mock-leads/bloom-studio
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Waypoint Ventures — Negotiating

- Contact: Casey Park; imessage; +12025550109. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $4,500; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Alumni introduction. Interested in judging and startup mentorship.
- Fit to verify: Finance partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Review proposed benefits. Follow-up: 2026-10-04.
- Placeholder lead source: https://example.com/mock-leads/waypoint-ventures
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Pinecone Coffee — Committed

- Contact: Drew Wilson; imessage; +12025550110. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $1,000; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Local partner confirmed coffee budget for opening day.
- Fit to verify: Food & beverage partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Confirm delivery time. Follow-up: 2026-10-09.
- Placeholder lead source: https://example.com/mock-leads/pinecone-coffee
- Fallback: Resolve fulfillment or payment timing; do not reopen pricing without organizer review.

### Bridge Analytics — Declined

- Contact: Quinn Hall; email; partner11@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $2,000; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Budget allocated this quarter. Revisit for the spring event.
- Fit to verify: Technology partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Reconnect next semester. Follow-up: 2026-12-02.
- Placeholder lead source: https://example.com/mock-leads/bridge-analytics
- Fallback: Pause outreach; revisit only when event timing or fit changes.

### Fieldwork Robotics — Qualified

- Contact: Robin Reed; email; partner12@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $3,000; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Research lab spinout. Good fit for the hardware track.
- Fit to verify: Hardware partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Prepare mentoring and prize proposal. Follow-up: 2026-10-05.
- Placeholder lead source: https://example.com/mock-leads/fieldwork-robotics
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Summit Security — Identified

- Contact: Dakota Gray; email; partner13@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $2,500; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Found in a fictional campus security-club directory. No prior conversation; verify the partnerships contact before pitching.
- Fit to verify: Security partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Verify student outreach contact. Follow-up: 2026-10-06.
- Placeholder lead source: https://example.com/mock-leads/summit-security
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Harbor Health — Qualified

- Contact: Reese Santos; linkedin; https://example.com/mock-linkedin/contact-14. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $2,000; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Mock alumni introduction confirmed interest in accessible health tools. Ask whether student projects or recruiting is the main goal.
- Fit to verify: Health tech partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Draft accessibility track proposal. Follow-up: 2026-10-05.
- Placeholder lead source: https://example.com/mock-leads/harbor-health
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Signal Mobile — Contacted

- Contact: Cameron Bell; imessage; +12025550115. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $4,000; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Sent a fictional connectivity proposal three days ago. Delivery receipt is recorded in the scenario; no reply yet. Silence does not establish interest.
- Fit to verify: Telecommunications partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Ask whether connectivity support fits. Follow-up: 2026-10-02.
- Placeholder lead source: https://example.com/mock-leads/signal-mobile
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Mosaic AI — Replied

- Contact: Skyler Reed; email; partner16@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $5,000; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Mock contact requested judging criteria and API usage estimates. No approved credit allocation yet. Send bounded usage assumptions and ask who approves credits.
- Fit to verify: AI partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Send API credit usage estimate. Follow-up: 2026-10-04.
- Placeholder lead source: https://example.com/mock-leads/mosaic-ai
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Red Oak Energy — Negotiating

- Contact: Parker Diaz; email; partner17@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $3,500; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Mock sponsor wants a sustainability challenge. Budget is capped at $3,500; exclusivity remains unapproved. Offer a scoped challenge without promising exclusivity.
- Fit to verify: Energy partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Review challenge scope with organizer. Follow-up: 2026-10-03.
- Placeholder lead source: https://example.com/mock-leads/red-oak-energy
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Meadow Books — Committed

- Contact: Finley Ross; linkedin; https://example.com/mock-linkedin/contact-18. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $2,500; received in scenario: $1,500.
- Mock evidence and approach: Fictional scenario: Fictional written commitment for $2,500; $1,500 received in the scenario. Confirm accessibility of learning materials and timing for the balance.
- Fit to verify: Education partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Confirm remaining payment date. Follow-up: 2026-10-07.
- Placeholder lead source: https://example.com/mock-leads/meadow-books
- Fallback: Resolve fulfillment or payment timing; do not reopen pricing without organizer review.

### Trailhead Travel — Declined

- Contact: Rowan Blake; email; partner19@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $1,500; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Mock contact declined because this event falls outside their campaign window. Respect the decision; reconnect only with a relevant future event.
- Fit to verify: Travel partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Revisit next semester if relevant. Follow-up: 2026-12-07.
- Placeholder lead source: https://example.com/mock-leads/trailhead-travel
- Fallback: Pause outreach; revisit only when event timing or fit changes.

### Lakeside Games — Identified

- Contact: Elliot Shaw; imessage; +12025550120. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $2,000; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Found through a fictional previous game-jam sponsor list. Developer community fit is plausible but unverified; no introduction is recorded.
- Fit to verify: Gaming partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Find community partnerships contact. Follow-up: 2026-10-07.
- Placeholder lead source: https://example.com/mock-leads/lakeside-games
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Cobalt Data — Qualified

- Contact: Sage Turner; email; partner21@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $3,000; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Mock engineering-club referral verified a student program. Prepare a database workshop proposal and ask about mentor availability.
- Fit to verify: Data tools partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Draft workshop and mentor request. Follow-up: 2026-10-05.
- Placeholder lead source: https://example.com/mock-leads/cobalt-data
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Acorn Education — Contacted

- Contact: Kendall Price; linkedin; https://example.com/mock-linkedin/contact-22. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $1,800; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Fictional email introduced the beginner track. Acknowledgment is not yet recorded; follow up once with a specific curriculum question.
- Fit to verify: Education partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Check beginner track sponsorship fit. Follow-up: 2026-10-01.
- Placeholder lead source: https://example.com/mock-leads/acorn-education
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Ember Audio — Replied

- Contact: Phoenix Ward; imessage; +12025550123. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $1,200; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Mock contact offered equipment lending instead of cash. Confirm inventory, return terms, and delivery logistics before valuing an in-kind commitment.
- Fit to verify: Hardware partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Request equipment and loan terms. Follow-up: 2026-10-04.
- Placeholder lead source: https://example.com/mock-leads/ember-audio
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### OpenWater Networks — Identified

- Contact: Marley Hughes; email; partner24@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $4,500; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Discovered through a fictional public university partnerships directory. Need the correct decision owner and confirmation that our event qualifies.
- Fit to verify: Infrastructure partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Verify university program eligibility. Follow-up: 2026-10-08.
- Placeholder lead source: https://example.com/mock-leads/openwater-networks
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Spruce Media — Qualified

- Contact: Blair Foster; email; partner25@example.com. Phone identity: +17344199492; email: owner@example.com.
- Owner: Alex Morgan. Proposed contribution: $1,500; received in scenario: $0.
- Mock evidence and approach: Fictional scenario: Mock student-newspaper introduction established interest in event storytelling. Agree on measurable deliverables and retain organizer review of any announcement.
- Fit to verify: Media partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Draft event coverage package. Follow-up: 2026-10-06.
- Placeholder lead source: https://example.com/mock-leads/spruce-media
- Fallback: Ask whether budget, timing, scope, or the decision owner is the blocker; propose a smaller approved scope only after learning the constraint.

### Stonebridge Manufacturing — Committed

- Contact: Emerson Cole; imessage; +12025550126. Phone identity: +17344199492; email: owner@example.com.
- Owner: Yash. Proposed contribution: $4,500; received in scenario: $1,000.
- Mock evidence and approach: Fictional scenario: Fictional returning partner confirmed $4,500; $1,000 received. Mentor attendance is still being scheduled, independent of the cash commitment.
- Fit to verify: Manufacturing partnership: connect an approved mentor session, student challenge, or recruiting benefit to this sponsor's stated goals. Validate the exact fit before outreach.
- Next step: Confirm mentor roster and balance. Follow-up: 2026-10-09.
- Placeholder lead source: https://example.com/mock-leads/stonebridge-manufacturing
- Fallback: Resolve fulfillment or payment timing; do not reopen pricing without organizer review.

