/* v10.761: DM message-payload helpers. E2EE was removed in v280 and the
   stub wrappers were pruned in v10.761. Filename kept for index.html load
   order — contents are now plaintext payload helpers only.

   isDirectMessageEncryptedRecord() is the one piece still useful: legacy
   Firestore threads from the E2EE era can still contain encrypted records
   without a key. The DM render path filters those out via this predicate
   so the inbox doesn't choke trying to render ciphertext. */

function isDirectMessageEncryptedRecord(message = {}) {
  return !!(message && (message.isEncrypted || message.dmE2ee || message.encryptedPayload || message.ciphertext));
}

function getDirectMessagePlainPayload(message = {}) {
  if (!message || typeof message !== 'object' || isDirectMessageEncryptedRecord(message)) {
    return { text: '', shareMedia: null, imageData: '', imageName: '' };
  }
  return {
    text: String(message.text || ''),
    shareMedia: message.shareMedia || null,
    imageData: message.imageData || '',
    imageName: message.imageName || message.name || ''
  };
}

function renderDirectMessagePayloadContent(payload = {}, encrypted = false) {
  const normalizedShare = payload.shareMedia && typeof normalizeSharedMediaPayload === 'function'
    ? normalizeSharedMediaPayload(payload.shareMedia)
    : payload.shareMedia || null;
  const shareHtml = normalizedShare && typeof renderDirectMessageShareCard === 'function'
    ? renderDirectMessageShareCard({ shareMedia: normalizedShare })
    : '';
  const imageHtml = payload.imageData ? `<img class="dm-photo-message" src="${escAttr(payload.imageData)}" alt="${escAttr(payload.imageName || 'Photo message')}" loading="lazy">` : '';
  const textHtml = payload.text ? `<span class="dm-message-text">${escHtml(payload.text || '')}</span>` : '';
  return `${shareHtml}${imageHtml}${textHtml}`;
}
