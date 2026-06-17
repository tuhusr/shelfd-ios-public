# Quick Start: Direct Message E2EE

## Current Status

E2EE is implemented for new Direct Message payloads.

New messages are encrypted in the browser before Firestore sees them. Firestore receives an encrypted `dmE2ee` envelope instead of plaintext `text`, `shareMedia`, or `imageData`.

## What To Test

- Sign in as User A.
- Sign in as User B at least once so User B publishes a DM encryption public key.
- Send a DM from User A to User B.
- Check Firestore: the new message should have `isEncrypted: true` and a `dmE2ee` object.
- Confirm there is no plaintext `text` field on the new message.
- Confirm User A can read the sent message.
- Confirm User B can read the received message.
- Try a shared media card and a photo message.

## Expected Failure Cases

- If a recipient has not opened the app since E2EE was added, sending can fail with a secure messaging setup message.
- If browser storage is cleared, that device can lose the private key and old encrypted messages may show as unavailable.
- If Web Crypto is unavailable, encrypted sending is blocked instead of falling back to plaintext.

## What Still Needs Hardening

For the highest-security version, add these next:

- A key verification screen that compares fingerprints between friends.
- A private-key backup/export flow protected by a user passphrase.
- Multi-device enrollment.
- Key rotation and recovery UI.
- Separate message storage outside user docs for larger encrypted photo payloads.

## Important Reminder

E2EE protects message contents. It does not hide metadata like sender, recipient, time, group membership, or message size.
