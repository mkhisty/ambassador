// Gmail personal-account attachment limit and API MIME upload limit.
// https://support.google.com/mail/answer/6584
// https://gmail.googleapis.com/$discovery/rest?version=v1 (messages.send.maxSize)
export const MAX_EMAIL_ATTACHMENTS = 20;
export const MAX_EMAIL_ATTACHMENT_BYTES = 25_000_000;
export const MAX_EMAIL_MIME_BYTES = 35 * 1024 * 1024;

export function checkAttachmentTotal(sizes) {
  if (sizes.length > MAX_EMAIL_ATTACHMENTS || sizes.some(size => !Number.isSafeInteger(size) || size < 1)) {
    throw Object.assign(new Error('Invalid email attachment size or count.'), { status: 400 });
  }
  if (sizes.reduce((total, size) => total + size, 0) > MAX_EMAIL_ATTACHMENT_BYTES) {
    throw Object.assign(new Error('Attachments exceed the 25 MB email limit.'), { status: 413 });
  }
}

export function encodeEmailMime(message) {
  const bytes = Buffer.from(message, 'utf8');
  if (bytes.length > MAX_EMAIL_MIME_BYTES) {
    throw Object.assign(new Error('The encoded email exceeds Gmail’s message size limit.'), { status: 413 });
  }
  return bytes.toString('base64url');
}

export function attachmentHeaders(file) {
  if (typeof file.mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(file.mime) ||
      typeof file.name !== 'string' || !file.name || /[\x00-\x1f\x7f]/.test(file.name)) {
    throw Object.assign(new Error('Invalid email attachment metadata.'), { status: 400 });
  }
  const name = file.name.replace(/^.*[\\/]/, '') || 'document';
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  return `Content-Type: ${file.mime}\r\nContent-Disposition: attachment; filename="${fallback}"; filename*=UTF-8''${encoded}\r\nContent-Transfer-Encoding: base64`;
}
