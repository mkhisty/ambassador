// A tapback acknowledges receipt without sending a separate message.
export async function acknowledgeMessage(message) {
  if (message.direction !== 'inbound' || ['reaction', 'read'].includes(message.content?.type)) return;
  try {
    await message.react('👍');
  } catch (error) {
    console.error('Thumbs-up reaction failed:', error.message);
  }
}
