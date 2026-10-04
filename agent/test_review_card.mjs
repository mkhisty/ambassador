import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewCard, createReviewCards } from './review-card.mjs';

const miniApp = (url, options) => ({ build: async () => ({ type: 'app', url: async () => url, ...options }) });

test('cards have explicit captions and open as sheets', async () => {
  for (const [state, title] of [['pending', 'Review message'], ['calendar_pending', 'Review calendar event'], ['approve', 'Approved'], ['edit_approve', 'Approved'], ['reject', 'Rejected']]) {
    const card = await reviewCard(miniApp, 'https://example.test/review/1', state).build();
    assert.equal(card.live, false);
    assert.equal((await card.layout()).caption, title);
  }
});

test('decision edits the original message rather than sending a second card', async () => {
  const sends = [], edits = [];
  const message = { id: 'original', miniAppCardSession: { id: 'session' }, edit: async card => edits.push(await card.build()) };
  const space = { send: async card => { sends.push(await card.build()); return message; } };
  const cards = createReviewCards(miniApp);
  await cards.send(space, 'review', 'https://example.test/review/1');
  await cards.update('review', 'edit_approve');
  assert.equal(sends.length, 1);
  assert.equal(edits.length, 1);
  assert.equal((await edits[0].layout()).caption, 'Approved');
  assert.equal(await edits[0].url(), 'https://example.test/review/1?decision=edit_approve');
});

test('immediate decision waits for the original send to complete', async () => {
  let resolveSend, edited = false;
  const cards = createReviewCards(miniApp);
  const sending = cards.send({ send: () => new Promise(resolve => { resolveSend = resolve; }) }, 'review', 'https://example.test/review/1');
  const updating = cards.update('review', 'reject');
  assert.equal(edited, false);
  resolveSend({ miniAppCardSession: {}, edit: async () => { edited = true; } });
  await Promise.all([sending, updating]);
  assert.equal(edited, true);
});

test('missing provider session blocks update without sending a replacement', async () => {
  const cards = createReviewCards(miniApp);
  await cards.send({ send: async () => ({ id: 'original' }) }, 'review', 'https://example.test/review/1');
  await assert.rejects(cards.update('review', 'approve'), /editable mini-app session/);
});
