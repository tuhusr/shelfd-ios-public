# Direct Message E2EE Implementation Guide

## What Is Implemented

ScreenList Direct Messages now use browser-side end-to-end encryption for new message payloads.

New DM payloads are encrypted before they are mirrored into Firestore:

- Message text
- Shared media card payloads
- Photo data and photo names

The server/Firebase stores encrypted envelopes only. Existing older plaintext messages are still rendered for backwards compatibility, but new messages are sent as encrypted messages.

## Cryptographic Design

The implementation uses the Web Crypto API with a hybrid envelope:

- ECDH P-256 user identity keys
- HKDF-SHA-256 to derive per-recipient wrapping keys
- AES-GCM-256 for authenticated encryption
- One encrypted content payload per message
- One encrypted content key box per participant

This avoids RSA-encrypting message bodies directly. That older approach is brittle for real messages, photos, and group chats.

## Where Keys Live

Each signed-in user gets an ECDH key pair.

The public key is stored on the user document:

```js
dmEncryptionPublicKey
dmEncryptionKeyVersion
dmEncryptionFingerprint
dmEncryptionAlgorithm
dmEncryptionUpdatedAtMs
```

The private key stays on the user's device. The app first tries to store it as a non-extractable CryptoKey in IndexedDB. If the browser cannot persist that, it falls back to a private JWK in localStorage.

Important consequence: if a user clears browser data or switches devices, old encrypted messages may be unreadable on that device until a secure key backup/import flow is added.

## Message Shape

New encrypted messages look like this:

```js
{
  id: "msg_uid_timestamp",
  fromUid: "senderUid",
  createdAtMs: 1234567890,
  isEncrypted: true,
  dmE2ee: {
    v: 1,
    alg: "ECDH-P256-HKDF-SHA256-AES-GCM",
    senderUid: "senderUid",
    senderPublicKey: { kty: "EC", crv: "P-256", x: "...", y: "..." },
    iv: "...",
    ciphertext: "...",
    boxes: {
      "recipientUid": { iv: "...", key: "..." },
      "senderUid": { iv: "...", key: "..." }
    }
  }
}
```

The plaintext fields `text`, `shareMedia`, and `imageData` are not written for new messages.

## Compatibility

Old messages are still displayed from their legacy plaintext fields.

New messages require every participant to have `dmEncryptionPublicKey`. If someone has not signed in since this feature was added, sending to them can fail until they open the app once and their key is published.

## Security Notes

This is real client-side E2EE for message contents, but it is not a complete Signal-style protocol yet.

Still visible to the server:

- Who is messaging whom
- Thread IDs
- Message timestamps
- Message sizes
- Group membership
- Display names and avatars in thread metadata

Not yet implemented:

- Device-to-device key verification
- Encrypted cloud key backup
- Multi-device key sync
- Forward secrecy with rotating message keys
- Post-compromise recovery

The most important next hardening step is key verification, because public keys are currently fetched from Firestore. Without verification, a malicious server or compromised database could theoretically replace a public key before a message is sent.
