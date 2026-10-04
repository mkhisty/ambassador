const labels = {
  pending: ['Review message', 'Tap to approve, edit, or reject'],
  approve: ['Approved', 'Your response was recorded'],
  edit_approve: ['Approved', 'Edited response recorded'],
  reject: ['Rejected', 'Your response was recorded'],
};

export function reviewCard(miniApp, url, state = 'pending') {
  if (!labels[state]) throw new Error('Invalid review state');
  const [caption, subcaption] = labels[state];
  return {
    async build() {
      const content = await miniApp(url, { live: false }).build();
      // Supply explicit layout text; avoid relying on link preview metadata.
      return { ...content, layout: async () => ({ caption, subcaption, summary: caption }) };
    },
  };
}

export function createReviewCards(miniApp) {
  const cards = new Map();
  return {
    async send(space, id, url) {
      if (cards.has(id)) throw new Error('Review card already sent');
      const sent = space.send(reviewCard(miniApp, url));
      cards.set(id, { sent, url, created: Date.now() });
      // Match the widget's 24-hour expiry.
      for (const [key, card] of cards) if (Date.now() - card.created >= 86400000) cards.delete(key);
      try { return await sent; }
      catch (error) { cards.delete(id); throw error; }
    },
    async update(id, state) {
      if (state === 'pending' || !labels[state]) throw new Error('Invalid review decision');
      const card = cards.get(id);
      if (!card) throw new Error('Original review card is unavailable');
      const message = await card.sent;
      if (!message?.miniAppCardSession || typeof message.edit !== 'function') {
        throw new Error('Photon did not return an editable mini-app session');
      }
      // The installed Spectrum 12.7 SDK uses edit(), which preserves the session.
      await message.edit(reviewCard(miniApp, card.url + '?decision=' + state, state));
    },
  };
}
