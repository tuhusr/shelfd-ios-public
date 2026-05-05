// v280: Direct Message E2EE removed/disabled. Plaintext compatibility helpers only.
const DM_E2EE_MISSING_KEY_TOAST = '';
const DM_E2EE_OWN_KEY_TOAST = '';

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

async function encryptDirectMessagePayloadForThread(thread = {}, messageId = '', payload = {}) {
  return {
    isEncrypted: false,
    text: String(payload?.text || ''),
    shareMedia: payload?.shareMedia || null,
    imageData: payload?.imageData || '',
    imageName: payload?.imageName || ''
  };
}

async function decryptDirectMessagePayload(threadId = '', message = {}) {
  return getDirectMessagePlainPayload(message);
}

function renderDirectMessageEncryptedContent() {
  return '';
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

function hydrateDirectMessageEncryptionInView() {}
async function ensureDirectMessageEncryptionReady() { return { disabled: true }; }
function showDmE2eeMissingKeyWarningToast() {}
function showDmE2eeOwnKeyRequiredToast() {}
function closeDmE2eeRecoveryModal() {
  document.querySelectorAll('.dm-e2ee-recovery-modal, #dm-e2ee-recovery-modal').forEach(node => node.remove());
}
closeDmE2eeRecoveryModal();
