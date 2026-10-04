import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgeMessage } from './message-receipts.mjs';

test('incoming text, replies, and attachments receive a thumbs-up tapback', async () => {
  for (const type of ['text', 'reply', 'attachment']) {
    const reactions = [];
    await acknowledgeMessage({
      direction: 'inbound', content: { type },
      react: async emoji => reactions.push(emoji),
      send: () => assert.fail('Read acknowledgement must not send a text'),
    });
    assert.deepEqual(reactions, ['👍']);
  }
});

test('outbound messages, reactions, and read receipts do not get tapbacks', async () => {
  for (const [direction, type] of [['outbound', 'text'], ['inbound', 'reaction'], ['inbound', 'read']]) {
    await acknowledgeMessage({direction, content: {type}, react: () => assert.fail('Unexpected tapback')});
  }
});

test('a failed reaction does not prevent the message from being processed', async () => {
  const original = console.error, errors = [];
  console.error = (...args) => errors.push(args);
  try {
    await acknowledgeMessage({direction: 'inbound', content: {type: 'text'}, react: async () => {throw new Error('Provider unavailable');}});
    assert.equal(errors.length, 1);
  } finally {
    console.error = original;
  }
});
