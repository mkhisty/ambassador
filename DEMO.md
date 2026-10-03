# Ambassador: hackathon sponsorship coordinator

Ambassador helps hackathon organizers manage sponsor leads, outreach, and contract status. Organizers interact with the agent through iMessage using Photon Spectrum.

## Demo flow

1. The organizer texts: "Check our sponsorship leads and prepare the next outreach."
2. Ambassador reads the chosen Notion database or Google Sheet. Each lead includes company, contact, preferred outreach channel, address/profile, relationship notes, sponsorship ask, owner, and status.
3. It selects a lead that has not already been contacted, explains the fit, and drafts a message using the event facts and relationship history.
4. In the organizer's Spectrum-connected iMessage conversation, it shows the recipient, channel, subject when applicable, and exact message. The organizer can approve, edit, or reject that specific draft.
5. Only an authorized organizer's approval of the current draft permits sending. Changing the recipient, channel, or message requires approval again.
6. Ambassador sends through the selected connected channel and records the provider result. It reports success only after the provider confirms acceptance; acceptance does not establish delivery or a reply.
7. It updates the lead record and remembers the interaction after a restart. A repeated approval must not send a duplicate message. An uncertain send result requires reconciliation before retrying.
8. When a sponsor responds, it summarizes the reply and prepares the next action for organizer approval. Track contract link, agreed terms, responsible organizer, and status; do not treat outreach approval as permission to sign a contract or accept new terms.

## First live demonstration

Use one lead source and one email account for the first complete flow: lead lookup -> draft -> organizer approval over Spectrum iMessage -> real email -> recorded send result. Then demonstrate editing a draft and persistent memory.

The intended outreach channels are email, iMessage, and LinkedIn. Each needs a verified sending integration. Unsupported or unconnected channels must remain explicitly unsent; a prepared LinkedIn draft is not a sent message.

## Inputs needed for the live send

- Notion page/database or Google Sheet and access.
- Hackathon name, date, audience, organizer identity, approved sponsorship ask, and relevant sponsorship document.
- Recipient and preferred channel from the lead record.
- Connected sending account and Spectrum project credentials, provided through secure configuration.
- Organizer identity authorized to approve messages.

## Current state

An offline mock demo is available in `demo/`. Run `python demo/run_demo.py` to generate importable lead data, drafts, a simulated iMessage approval conversation, and a local `.eml` outbox. Run `python demo/test_demo.py` to check approval and duplicate handling. All identities and approvals are fictional. No outreach has been delivered.

Live Notion/Sheets reads, AI-generated drafting, Spectrum iMessage, email delivery, and LinkedIn sending are not implemented. The mock fixtures and deterministic drafts demonstrate the intended workflow only.
