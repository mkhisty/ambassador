# Ambassador mobile visual direction

## Scope

This is a proposed mobile interaction prototype, not a shipped mobile application. The primary product surface remains a Photon/iMessage conversation; the website is the companion for overview, account linking, charts, bulk imports, and integration administration. The user explicitly requested a more polished visual concept inspired by MHacks. The existing grayscale wireframes remain as an archive.

## Direction contract

**Thesis:** An immediately readable conversation with useful campaign context, exact draft review, and clear action receipts. One selected phone preview replaces the board of miniature phones.

**Own world:** MHacks-inspired moss greens, warm ivory, restrained soft blue/lavender tones, expressive serif headings, and native system text in the conversation. Native Messages chrome stays recognizable. No MHacks logos or artwork are copied.

**Story:** Connect the selected information sources, review campaign context, inspect a contact, create a Gmail draft, approve its exact version, and see email and tracking results separately.

**First viewport:** Campaign context and a compact moment selector sit beside a readable phone preview. The active moment and its primary action remain obvious. On narrow screens, the selector and phone stack without horizontal page overflow.

**Form:** The user pinned MHacks as the visual reference; no random direction selection applies. This is a code-built interactive concept, using standard browser controls. Switching conversation moments is the signature interaction; it does not navigate into a separate mobile app.

**Finish:** Inspect desktop and phone-width layouts together, correct material defects in one pass, then confirm. Record the chosen visual direction and screenshot provenance. This prototype must not imply live provider access.

## Sources and asset provenance

- MHacks reference: https://www.mhacks.org/ — inspected directly on October 4, 2026. Visual reference only; no assets copied.
- Official Apple design resources: https://developer.apple.com/design/resources/ — includes iOS kits and a Messages template.
- Apple Messages template linked by Apple: https://www.figma.com/community/file/1367916269438172112/imessage-apps-and-stickers — discovered through Apple's resources page. No Figma components have been imported into the HTML prototype.
- Impeccable upstream skill and craft guidance: https://github.com/pbakaus/impeccable/tree/main/.agents/skills/impeccable — read as guidance. Its local launcher is unavailable; existing product and design documents were read directly.
- Screenshots under `design/` are browser captures of this local HTML prototype and use fictional demonstration content.

## Constraints

Notion supplies shared context. One Google Sheet is the campaign's authoritative contact tracker; Excel is an import/export option unless live workbook synchronization is chosen. Gmail supplies sender identity, drafts, messages, and replies. Hermes's exact client role remains unconfirmed. Calendar integration and mobile account linking are proposed. No action in the prototype sends an email, modifies a shared page, writes to a Sheet, or creates a calendar event.

Use immutable draft references, explicit approval, owner-authorized document access, and separate provider/tracker status. A failed tracker update must never trigger a duplicate email send. Every example account, contact, message, and connection status is fictional.

## Review and delivered concept

`design/mobile-imessage-concept.html` is the polished replacement concept. The old wireframe is preserved. Eight selectors change the phone conversation and contextual explanation. Simulated approval shows a local feedback message and calls no provider.

Reviewed at the browser's desktop size and a 390 × 844 mobile viewport. The mobile page had no horizontal overflow. Confirmed the draft selector, complete Gmail sender/recipient/body, source references, and simulated approval feedback. The refinement pass moved the selectors above the phone, improved card hierarchy and header spacing, and kept touch targets at least 44 pixels tall.

Verdict: ready for visual feedback and widget handoff; not evidence of production iMessage widget support or working provider integrations. `design/mobile-concept-preview.jpg` is a browser screenshot of the refined local concept, captured October 4, 2026. The meadow-like backdrop is authored CSS, not a copied MHacks asset or generated photograph. The web application's visual system is unchanged by this concept.
