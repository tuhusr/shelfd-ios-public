// Direct Messages E2EE helpers and secure message payload handling.
const DM_E2EE_VERSION = 1;
const DM_E2EE_ALGORITHM = 'ECDH-P256-HKDF-SHA256-AES-GCM';
const DM_E2EE_MISSING_KEY_TOAST = 'User has not updated their app - They do not have a Encrypted End-to-End Key';
const DM_E2EE_OWN_KEY_TOAST = 'You DO NOT HAVE A End-to-End Encryption KEY.\nThe user you are trying to message has a End-to-End Encryption.\nPlease sign out, and sign back in to generate a E2EE Key';
const DM_E2EE_PRIVATE_KEY_MISSING_TOAST = 'Your End-to-End Encryption private key is missing on this device.\nYour encrypted chat history is still saved, but this browser cannot decrypt it.\nUse the original browser/device that created the key, or restore from a future key backup.';
const DM_E2EE_INFO_PREFIX = 'ScreenList DM E2EE v1';
const DM_E2EE_PUBLIC_FIELD = 'dmEncryptionPublicKey';
const DM_E2EE_KEY_VERSION_FIELD = 'dmEncryptionKeyVersion';
const DM_E2EE_LOCAL_PUBLIC_PREFIX = 'screenlist_dm_e2ee_public_';
const DM_E2EE_LOCAL_PRIVATE_PREFIX = 'screenlist_dm_e2ee_private_jwk_';
const DM_E2EE_BACKUP_FIELD = 'dmEncryptionKeyBackup';
const DM_E2EE_BACKUP_VERSION = 1;
const DM_E2EE_BACKUP_ITERATIONS = 240000;
const DM_E2EE_RECOVERY_NOTICE_PREFIX = 'screenlist_dm_e2ee_recovery_notice_';
let dmEncryptionReadyPromise = null;
let dmE2eeRecoveryModalPromise = null;
const dmE2eeDecryptCache = new Map();

function hasDirectMessageCryptoSupport() {
  return !!(window.crypto && window.crypto.subtle && window.TextEncoder && window.TextDecoder);
}

function dmE2eeEncodeText(value = '') {
  return new TextEncoder().encode(String(value || ''));
}

function dmE2eeDecodeText(value) {
  return new TextDecoder().decode(value);
}

function dmE2eeBytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  for (let i = 0; i < arr.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, arr.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

function dmE2eeBase64ToBytes(value = '') {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function dmE2eeCanonicalJson(value) {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(dmE2eeCanonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${dmE2eeCanonicalJson(value[key])}`).join(',')}}`;
}

async function dmE2eeSha256Base64Url(value = '') {
  const digest = await crypto.subtle.digest('SHA-256', dmE2eeEncodeText(value));
  return dmE2eeBytesToBase64(new Uint8Array(digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getDmE2eeRecoveryNoticeKey(uid = '') {
  return DM_E2EE_RECOVERY_NOTICE_PREFIX + String(uid || 'anon');
}

function hasSeenDmE2eeRecoveryNotice(uid = '') {
  try { return localStorage.getItem(getDmE2eeRecoveryNoticeKey(uid)) === '1'; }
  catch (error) { return false; }
}

function markDmE2eeRecoveryNoticeSeen(uid = '') {
  try { localStorage.setItem(getDmE2eeRecoveryNoticeKey(uid), '1'); } catch (error) {}
}

function getDmE2eeRecoveryBackupFromUserData(userData = {}) {
  const backup = userData?.[DM_E2EE_BACKUP_FIELD] || userData?.dmE2eeKeyBackup || null;
  if (!backup || typeof backup !== 'object') return null;
  if (!backup.salt || !backup.iv || !backup.ciphertext) return null;
  return backup;
}

async function deriveDmE2eeRecoveryAesKey(passphrase = '', saltBase64 = '', iterations = DM_E2EE_BACKUP_ITERATIONS) {
  const password = String(passphrase || '');
  if (!password || !saltBase64) throw new Error('Missing Shelfd Secure Key password');
  const keyMaterial = await crypto.subtle.importKey('raw', dmE2eeEncodeText(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: dmE2eeBase64ToBytes(saltBase64), iterations: Math.max(120000, Number(iterations || DM_E2EE_BACKUP_ITERATIONS)) },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function buildDmE2eePrivateKeyBackup(privateJwk = null, passphrase = '') {
  if (!privateJwk || !privateJwk.d) throw new Error('Missing private key to back up');
  const cleanPassphrase = String(passphrase || '');
  if (cleanPassphrase.length < 6) throw new Error('Shelfd Secure Key password must be at least 6 characters');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const saltBase64 = dmE2eeBytesToBase64(salt);
  const key = await deriveDmE2eeRecoveryAesKey(cleanPassphrase, saltBase64, DM_E2EE_BACKUP_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: dmE2eeEncodeText(`${DM_E2EE_INFO_PREFIX}|account-key-backup|v${DM_E2EE_BACKUP_VERSION}`) },
    key,
    dmE2eeEncodeText(JSON.stringify(privateJwk))
  );
  return {
    v: DM_E2EE_BACKUP_VERSION,
    alg: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA256',
    iterations: DM_E2EE_BACKUP_ITERATIONS,
    salt: saltBase64,
    iv: dmE2eeBytesToBase64(iv),
    ciphertext: dmE2eeBytesToBase64(new Uint8Array(ciphertext)),
    createdAtMs: Date.now()
  };
}

async function decryptDmE2eePrivateKeyBackup(backup = null, passphrase = '') {
  if (!backup || !backup.salt || !backup.iv || !backup.ciphertext) throw new Error('Missing Shelfd Secure Key backup');
  const key = await deriveDmE2eeRecoveryAesKey(passphrase, backup.salt, backup.iterations || DM_E2EE_BACKUP_ITERATIONS);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: dmE2eeBase64ToBytes(backup.iv), additionalData: dmE2eeEncodeText(`${DM_E2EE_INFO_PREFIX}|account-key-backup|v${backup.v || DM_E2EE_BACKUP_VERSION}`) },
    key,
    dmE2eeBase64ToBytes(backup.ciphertext)
  );
  const privateJwk = JSON.parse(dmE2eeDecodeText(decrypted));
  if (!privateJwk || privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256' || !privateJwk.d) throw new Error('Invalid restored private key');
  return privateJwk;
}

async function saveDmE2eeRecoveryBackup(uid = '', privateJwk = null, passphrase = '') {
  if (!uid || !privateJwk) return null;
  const backup = await buildDmE2eePrivateKeyBackup(privateJwk, passphrase);
  await db.collection('users').doc(uid).set({
    [DM_E2EE_BACKUP_FIELD]: backup,
    dmEncryptionBackupEnabled: true,
    dmEncryptionBackupUpdatedAtMs: Date.now()
  }, { merge: true });
  usersMap[uid] = {
    ...(usersMap[uid] || {}),
    uid,
    [DM_E2EE_BACKUP_FIELD]: backup,
    dmEncryptionBackupEnabled: true,
    dmEncryptionBackupUpdatedAtMs: Date.now()
  };
  markDmE2eeRecoveryNoticeSeen(uid);
  return backup;
}

function closeDmE2eeRecoveryModal() {
  const modal = document.getElementById('dm-e2ee-recovery-modal');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => modal.remove(), 180);
}

function showDmE2eeRecoveryPasswordModal(mode = 'unlock', options = {}) {
  if (dmE2eeRecoveryModalPromise) return dmE2eeRecoveryModalPromise;
  const isSetup = mode === 'setup';
  const isReset = mode === 'reset';
  dmE2eeRecoveryModalPromise = new Promise(resolve => {
    const existing = document.getElementById('dm-e2ee-recovery-modal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'dm-e2ee-recovery-modal';
    overlay.className = 'dm-e2ee-recovery-modal';
    const title = isSetup ? 'Create your Shelfd Secure Key' : (isReset ? 'Reset encrypted messages key?' : 'Unlock encrypted messages');
    const copy = isSetup
      ? 'Create one password to restore your encrypted messages on any phone, desktop, browser, or Home Screen app. Shelfd never saves this password.'
      : isReset
        ? 'This device cannot find your old private key and no encrypted backup exists yet. New messages can work after a reset, but older encrypted messages may stay locked on this device.'
        : 'Enter your Shelfd Secure Key password to restore your private key on this device and unlock your chat history.';
    overlay.innerHTML = `
      <div class="dm-e2ee-recovery-card" role="dialog" aria-modal="true" aria-label="${escAttr(title)}">
        <button class="dm-e2ee-recovery-x" type="button" aria-label="Close">×</button>
        <div class="dm-e2ee-recovery-kicker">E2EE</div>
        <h3>${escHtml(title)}</h3>
        <p>${escHtml(copy)}</p>
        ${isReset ? '' : `
          <label class="dm-e2ee-recovery-label">Shelfd Secure Key password</label>
          <input class="dm-e2ee-recovery-input" id="dm-e2ee-recovery-pass" type="password" autocomplete="current-password" placeholder="Enter password">
          ${isSetup ? `<input class="dm-e2ee-recovery-input" id="dm-e2ee-recovery-confirm" type="password" autocomplete="new-password" placeholder="Confirm password">` : ''}
          <div class="dm-e2ee-recovery-error" id="dm-e2ee-recovery-error"></div>
        `}
        <div class="dm-e2ee-recovery-actions">
          <button class="dm-e2ee-recovery-secondary" type="button" id="dm-e2ee-recovery-cancel">${isReset ? 'Cancel' : 'Not now'}</button>
          <button class="dm-e2ee-recovery-primary" type="button" id="dm-e2ee-recovery-submit">${isSetup ? 'Save Secure Key' : isReset ? 'Create New Key' : 'Unlock'}</button>
        </div>
      </div>`;
    const finish = value => {
      closeDmE2eeRecoveryModal();
      dmE2eeRecoveryModalPromise = null;
      resolve(value);
    };
    overlay.querySelector('.dm-e2ee-recovery-x')?.addEventListener('click', () => finish(null));
    overlay.querySelector('#dm-e2ee-recovery-cancel')?.addEventListener('click', () => finish(null));
    overlay.addEventListener('click', event => { if (event.target === overlay) finish(null); });
    overlay.querySelector('#dm-e2ee-recovery-submit')?.addEventListener('click', () => {
      if (isReset) { finish('__RESET__'); return; }
      const pass = String(overlay.querySelector('#dm-e2ee-recovery-pass')?.value || '');
      const confirm = String(overlay.querySelector('#dm-e2ee-recovery-confirm')?.value || '');
      const error = overlay.querySelector('#dm-e2ee-recovery-error');
      if (pass.length < 6) {
        if (error) error.textContent = 'Use at least 6 characters.';
        return;
      }
      if (isSetup && pass !== confirm) {
        if (error) error.textContent = 'Passwords do not match.';
        return;
      }
      finish(pass);
    });
    overlay.querySelectorAll('input').forEach(input => {
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') overlay.querySelector('#dm-e2ee-recovery-submit')?.click();
      });
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add('open');
      overlay.querySelector('#dm-e2ee-recovery-pass')?.focus?.();
    });
  });
  return dmE2eeRecoveryModalPromise;
}

async function restoreDmE2eePrivateKeyFromBackup(uid = '', backup = null) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const passphrase = await showDmE2eeRecoveryPasswordModal('unlock');
    if (!passphrase) return null;
    try {
      const privateJwk = await decryptDmE2eePrivateKeyBackup(backup, passphrase);
      const privateKey = await importDmE2eePrivateKey(privateJwk);
      await storeDmE2eePrivateKey(uid, privateKey, privateJwk);
      markDmE2eeRecoveryNoticeSeen(uid);
      showToast('Encrypted messages unlocked', { durationMs: 1800 });
      return { privateKey, privateJwk };
    } catch (error) {
      console.warn('Shelfd Secure Key unlock failed:', error);
      showToast(attempt >= 2 ? 'Could not unlock encrypted messages' : 'Wrong Shelfd Secure Key password', { durationMs: 2200 });
    }
  }
  return null;
}

async function maybeSetupDmE2eeRecoveryBackup(uid = '', privateJwk = null, userData = {}, options = {}) {
  if (!uid || !privateJwk || options.silent || getDmE2eeRecoveryBackupFromUserData(userData) || hasSeenDmE2eeRecoveryNotice(uid)) return null;
  const passphrase = await showDmE2eeRecoveryPasswordModal('setup');
  if (!passphrase) {
    markDmE2eeRecoveryNoticeSeen(uid);
    return null;
  }
  try {
    const backup = await saveDmE2eeRecoveryBackup(uid, privateJwk, passphrase);
    showToast('Shelfd Secure Key saved', { durationMs: 1800 });
    return backup;
  } catch (error) {
    console.error('Could not save Shelfd Secure Key backup:', error);
    showToast('Could not save Secure Key backup', { durationMs: 2200 });
    return null;
  }
}

function isValidDmEncryptionPublicKey(key = null) {
  return !!(key && key.kty === 'EC' && key.crv === 'P-256' && key.x && key.y);
}

function getDmE2eeLocalPublicKey(uid = '') {
  try {
    const raw = localStorage.getItem(DM_E2EE_LOCAL_PUBLIC_PREFIX + uid);
    const parsed = raw ? JSON.parse(raw) : null;
    return isValidDmEncryptionPublicKey(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function setDmE2eeLocalPublicKey(uid = '', publicKey = null) {
  if (!uid || !isValidDmEncryptionPublicKey(publicKey)) return;
  try { localStorage.setItem(DM_E2EE_LOCAL_PUBLIC_PREFIX + uid, JSON.stringify(publicKey)); } catch (error) {}
}

function getDmE2eeLocalPrivateJwk(uid = '') {
  try {
    const raw = localStorage.getItem(DM_E2EE_LOCAL_PRIVATE_PREFIX + uid);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.kty === 'EC' && parsed.crv === 'P-256' && parsed.d ? parsed : null;
  } catch (error) {
    return null;
  }
}

function setDmE2eeLocalPrivateJwk(uid = '', privateKey = null) {
  if (!uid || !privateKey) return;
  try { localStorage.setItem(DM_E2EE_LOCAL_PRIVATE_PREFIX + uid, JSON.stringify(privateKey)); } catch (error) {}
}

function openDmE2eeKeyDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open('screenlist-dm-e2ee-v1', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function dmE2eeIdbGet(key = '') {
  const db = await openDmE2eeKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readonly');
    const req = tx.objectStore('keys').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => { try { db.close(); } catch (error) {} };
  });
}

async function dmE2eeIdbSet(key = '', value = null) {
  const db = await openDmE2eeKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { try { db.close(); } catch (error) {}; reject(tx.error || new Error('IndexedDB write failed')); };
  });
}

async function importDmE2eePrivateKey(privateJwk) {
  return crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );
}

async function importDmE2eePublicKey(publicJwk) {
  return crypto.subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

async function loadDmE2eePrivateKey(uid = '') {
  if (!uid || !hasDirectMessageCryptoSupport()) return null;
  try {
    const key = await dmE2eeIdbGet('ecdh-private-' + uid);
    if (key) return key;
  } catch (error) {}
  const fallbackJwk = getDmE2eeLocalPrivateJwk(uid);
  if (!fallbackJwk) return null;
  const restoredKey = await importDmE2eePrivateKey(fallbackJwk);
  try { await dmE2eeIdbSet('ecdh-private-' + uid, restoredKey); } catch (error) {}
  return restoredKey;
}

async function storeDmE2eePrivateKey(uid = '', privateKey = null, privateJwk = null) {
  if (!uid || !privateKey) return;
  if (privateJwk) setDmE2eeLocalPrivateJwk(uid, privateJwk);
  try {
    await dmE2eeIdbSet('ecdh-private-' + uid, privateKey);
    return;
  } catch (error) {
    console.warn('Secure Direct Message IndexedDB key storage failed; using local private-key backup only:', error);
  }
}

async function createDmE2eeKeyPair(uid = '') {
  const generated = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', generated.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', generated.privateKey);
  const privateKey = await importDmE2eePrivateKey(privateJwk);
  setDmE2eeLocalPublicKey(uid, publicJwk);
  await storeDmE2eePrivateKey(uid, privateKey, privateJwk);
  return { privateKey, publicJwk };
}

async function ensureDirectMessageEncryptionReady(uid = currentUser?.uid || '', options = {}) {
  if (!uid || !currentUser || uid !== currentUser.uid) return null;
  if (!hasDirectMessageCryptoSupport()) throw new Error('This browser does not support Web Crypto E2EE');
  if (dmEncryptionReadyPromise) return dmEncryptionReadyPromise;
  const opts = { silent: false, ...options };
  dmEncryptionReadyPromise = (async () => {
    let privateKey = await loadDmE2eePrivateKey(uid);
    let privateJwk = getDmE2eeLocalPrivateJwk(uid);
    let publicJwk = getDmE2eeLocalPublicKey(uid);
    let userData = {};
    let remotePublicJwk = null;
    let recoveryBackup = null;
    try {
      const snap = await db.collection('users').doc(uid).get();
      userData = snap.exists ? (snap.data() || {}) : {};
      remotePublicJwk = userData?.[DM_E2EE_PUBLIC_FIELD] || null;
      if (!isValidDmEncryptionPublicKey(remotePublicJwk)) remotePublicJwk = null;
      recoveryBackup = getDmE2eeRecoveryBackupFromUserData(userData);
    } catch (error) {
      console.warn('Could not read existing DM encryption profile:', error);
    }

    if (!isValidDmEncryptionPublicKey(publicJwk) && remotePublicJwk) {
      publicJwk = remotePublicJwk;
      setDmE2eeLocalPublicKey(uid, publicJwk);
    }

    if (!privateKey && recoveryBackup) {
      if (opts.silent) return null;
      const restored = await restoreDmE2eePrivateKeyFromBackup(uid, recoveryBackup);
      if (restored?.privateKey) {
        privateKey = restored.privateKey;
        privateJwk = restored.privateJwk;
      } else {
        const error = new Error('Shelfd Secure Key password required to unlock encrypted messages.');
        error.dmE2eeOwnKeyMissing = true;
        error.dmE2eePrivateKeyMissing = true;
        error.dmE2eeNeedsUnlock = true;
        throw error;
      }
    }

    if (!privateKey && remotePublicJwk && !recoveryBackup) {
      if (opts.silent) return null;
      const resetChoice = await showDmE2eeRecoveryPasswordModal('reset');
      if (resetChoice !== '__RESET__') {
        const error = new Error('Encrypted message key reset was cancelled.');
        error.dmE2eeOwnKeyMissing = true;
        error.dmE2eePrivateKeyMissing = true;
        throw error;
      }
      publicJwk = null;
    }

    if (!privateKey || !isValidDmEncryptionPublicKey(publicJwk)) {
      const pair = await createDmE2eeKeyPair(uid);
      privateKey = pair.privateKey;
      privateJwk = getDmE2eeLocalPrivateJwk(uid);
      publicJwk = pair.publicJwk;
    }

    const fingerprint = await dmE2eeSha256Base64Url(dmE2eeCanonicalJson(publicJwk));
    const patch = {
      [DM_E2EE_PUBLIC_FIELD]: publicJwk,
      [DM_E2EE_KEY_VERSION_FIELD]: DM_E2EE_VERSION,
      dmEncryptionFingerprint: fingerprint,
      dmEncryptionAlgorithm: DM_E2EE_ALGORITHM,
      dmEncryptionUpdatedAtMs: Date.now()
    };
    await db.collection('users').doc(uid).set(patch, { merge: true });
    usersMap[uid] = {
      ...(usersMap[uid] || {}),
      uid,
      ...patch,
      ...(recoveryBackup ? { [DM_E2EE_BACKUP_FIELD]: recoveryBackup, dmEncryptionBackupEnabled: true } : {})
    };

    if (privateJwk) await maybeSetupDmE2eeRecoveryBackup(uid, privateJwk, { ...userData, ...(recoveryBackup ? { [DM_E2EE_BACKUP_FIELD]: recoveryBackup } : {}) }, opts);
    return { privateKey, publicJwk, fingerprint };
  })().finally(() => {
    dmEncryptionReadyPromise = null;
  });
  return dmEncryptionReadyPromise;
}

async function getDirectMessagePublicKeyForUid(uid = '') {
  if (!uid) return null;
  if (uid === currentUser?.uid) {
    const ready = await ensureDirectMessageEncryptionReady(uid);
    return ready?.publicJwk || null;
  }
  const cached = usersMap[uid]?.[DM_E2EE_PUBLIC_FIELD];
  if (isValidDmEncryptionPublicKey(cached)) return cached;
  const snap = await db.collection('users').doc(uid).get();
  const data = snap.exists ? { uid: snap.id, ...(snap.data() || {}) } : null;
  if (data?.uid) usersMap[uid] = { ...(usersMap[uid] || {}), ...data };
  const key = data?.[DM_E2EE_PUBLIC_FIELD];
  return isValidDmEncryptionPublicKey(key) ? key : null;
}

function getDmE2eePairInfo(threadId = '', senderUid = '', recipientUid = '') {
  const pair = [senderUid, recipientUid].map(uid => String(uid || '').trim()).sort().join('|');
  return `${DM_E2EE_INFO_PREFIX}|thread:${threadId}|pair:${pair}`;
}

async function deriveDmE2eeWrapKey(privateKey, publicJwk, threadId = '', senderUid = '', recipientUid = '') {
  const publicKey = await importDmE2eePublicKey(publicJwk);
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const salt = await crypto.subtle.digest('SHA-256', dmE2eeEncodeText(`${DM_E2EE_INFO_PREFIX}|salt|${threadId}`));
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: dmE2eeEncodeText(getDmE2eePairInfo(threadId, senderUid, recipientUid))
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function getDmE2eeAdditionalData(threadId = '', messageId = '', part = '') {
  return dmE2eeEncodeText(`${DM_E2EE_INFO_PREFIX}|${threadId}|${messageId}|${part}`);
}

function getDirectMessagePlainPayload(message = {}) {
  return {
    text: String(message.text || ''),
    shareMedia: message.shareMedia ? normalizeSharedMediaPayload(message.shareMedia) : null,
    imageData: message.imageData || '',
    imageName: message.imageName || ''
  };
}

async function encryptDirectMessagePayloadForThread(thread = {}, messageId = '', payload = {}) {
  const senderUid = currentUser?.uid || '';
  const participantUids = getDirectMessageParticipantUids(thread);
  if (!senderUid || !participantUids.includes(senderUid)) throw new Error('Missing secure message sender');
  let ready = null;
  try {
    ready = await ensureDirectMessageEncryptionReady(senderUid);
  } catch (error) {
    error.dmE2eeOwnKeyMissing = true;
    throw error;
  }
  if (!ready?.privateKey || !isValidDmEncryptionPublicKey(ready.publicJwk)) {
    const error = new Error('Your E2EE key is not ready on this device.');
    error.dmE2eeOwnKeyMissing = true;
    throw error;
  }
  const recipientPublicKeys = {};
  await Promise.all(participantUids.map(async uid => {
    const publicKey = await getDirectMessagePublicKeyForUid(uid);
    if (!isValidDmEncryptionPublicKey(publicKey)) {
      const profile = getDirectMessageProfile(uid, usersMap[uid] || thread.participants?.[uid] || {});
      const name = getDisplayName(profile, 'A participant');
      const error = new Error(`${name} needs to open the updated app once before secure messages can be sent.`);
      error.dmE2eeMissingPublicKey = true;
      throw error;
    }
    recipientPublicKeys[uid] = publicKey;
  }));

  const contentKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const contentKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', contentKey));
  const payloadIv = crypto.getRandomValues(new Uint8Array(12));
  const payloadBytes = dmE2eeEncodeText(JSON.stringify({
    text: String(payload.text || '').slice(0, 1000),
    shareMedia: payload.shareMedia ? normalizeSharedMediaPayload(payload.shareMedia) : null,
    imageData: payload.imageData || '',
    imageName: payload.imageName || ''
  }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: payloadIv, additionalData: getDmE2eeAdditionalData(thread.id, messageId, 'payload') },
    contentKey,
    payloadBytes
  ));
  const boxes = {};
  await Promise.all(participantUids.map(async uid => {
    const wrapKey = await deriveDmE2eeWrapKey(ready.privateKey, recipientPublicKeys[uid], thread.id, senderUid, uid);
    const boxIv = crypto.getRandomValues(new Uint8Array(12));
    const wrappedKey = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: boxIv, additionalData: getDmE2eeAdditionalData(thread.id, messageId, 'box:' + uid) },
      wrapKey,
      contentKeyRaw
    ));
    boxes[uid] = {
      iv: dmE2eeBytesToBase64(boxIv),
      key: dmE2eeBytesToBase64(wrappedKey)
    };
  }));

  return {
    isEncrypted: true,
    dmE2ee: {
      v: DM_E2EE_VERSION,
      alg: DM_E2EE_ALGORITHM,
      senderUid,
      senderPublicKey: ready.publicJwk,
      iv: dmE2eeBytesToBase64(payloadIv),
      ciphertext: dmE2eeBytesToBase64(ciphertext),
      boxes
    }
  };
}

async function decryptDirectMessagePayload(threadId = '', message = {}) {
  if (!message?.isEncrypted || !message?.dmE2ee) return getDirectMessagePlainPayload(message);
  const cacheKey = `${threadId}|${message.id || ''}|${message.dmE2ee.ciphertext || ''}`;
  if (dmE2eeDecryptCache.has(cacheKey)) return dmE2eeDecryptCache.get(cacheKey);
  try {
    const uid = currentUser?.uid || '';
    const envelope = message.dmE2ee || {};
    const box = envelope.boxes?.[uid];
    if (!uid || !box) throw new Error('No encrypted key box for this device');
    let privateKey = await loadDmE2eePrivateKey(uid);
    if (!privateKey) {
      const ready = await ensureDirectMessageEncryptionReady(uid);
      privateKey = ready?.privateKey || await loadDmE2eePrivateKey(uid);
    }
    if (!privateKey) throw new Error('Private key not found on this device');
    const wrapKey = await deriveDmE2eeWrapKey(privateKey, envelope.senderPublicKey, threadId, envelope.senderUid || message.fromUid || '', uid);
    const rawContentKey = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: dmE2eeBase64ToBytes(box.iv), additionalData: getDmE2eeAdditionalData(threadId, message.id || '', 'box:' + uid) },
      wrapKey,
      dmE2eeBase64ToBytes(box.key)
    );
    const contentKey = await crypto.subtle.importKey('raw', rawContentKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: dmE2eeBase64ToBytes(envelope.iv), additionalData: getDmE2eeAdditionalData(threadId, message.id || '', 'payload') },
      contentKey,
      dmE2eeBase64ToBytes(envelope.ciphertext)
    );
    const parsed = JSON.parse(dmE2eeDecodeText(decrypted));
    const payload = {
      text: String(parsed.text || ''),
      shareMedia: parsed.shareMedia ? normalizeSharedMediaPayload(parsed.shareMedia) : null,
      imageData: parsed.imageData || '',
      imageName: parsed.imageName || ''
    };
    dmE2eeDecryptCache.set(cacheKey, payload);
    return payload;
  } catch (error) {
    console.warn('Direct Message decrypt failed:', error);
    return { text: '[Encrypted message locked. Open Messages and enter your Shelfd Secure Key to restore it.]', shareMedia: null, imageData: '', imageName: '', e2eeError: true };
  }
}

function renderDirectMessagePayloadContent(payload = {}, encrypted = false) {
  const normalizedShare = payload.shareMedia ? normalizeSharedMediaPayload(payload.shareMedia) : null;
  const shareHtml = normalizedShare ? renderDirectMessageShareCard({ shareMedia: normalizedShare }) : '';
  const imageHtml = payload.imageData ? `<img class="dm-photo-message" src="${escAttr(payload.imageData)}" alt="${escAttr(payload.imageName || 'Photo message')}" loading="lazy">` : '';
  const textHtml = payload.text ? `<span class="dm-message-text">${escHtml(payload.text || '')}</span>` : '';
  const badgeHtml = encrypted ? '<b class="dm-e2ee-badge" title="End-to-end encrypted">E2EE</b>' : '';
  const fallbackHtml = encrypted && !shareHtml && !imageHtml && !textHtml
    ? '<span class="dm-message-text dm-e2ee-loading">Secure message</span>'
    : '';
  return `${shareHtml}${imageHtml}${textHtml}${fallbackHtml}${badgeHtml}`;
}

function renderDirectMessageEncryptedContent(message = {}, threadId = '') {
  return `<div class="dm-e2ee-content" data-dm-e2ee-thread-id="${escAttr(threadId)}" data-dm-e2ee-message-id="${escAttr(message.id || '')}"><span class="dm-message-text dm-e2ee-loading">Decrypting secure message...</span><b class="dm-e2ee-badge" title="End-to-end encrypted">E2EE</b></div>`;
}

async function hydrateDirectMessageEncryptionInView(threadId = '') {
  const thread = dmThreadMap[threadId];
  if (!thread) return;
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const nodes = Array.from(document.querySelectorAll('[data-dm-e2ee-message-id]'))
    .filter(node => node.dataset.dmE2eeThreadId === threadId);
  await Promise.all(nodes.map(async node => {
    const message = messages.find(item => String(item.id || '') === String(node.dataset.dmE2eeMessageId || ''));
    if (!message) return;
    const payload = await decryptDirectMessagePayload(threadId, message);
    if (activeDmThreadId !== threadId) return;
    node.innerHTML = renderDirectMessagePayloadContent(payload, true);
    node.classList.toggle('dm-e2ee-error', !!payload.e2eeError);
  }));
}
