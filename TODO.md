# Project TODO

## Phase 1: Laptop Receiver

- [x] Create local receiver CLI with one-time pairing code.
- [x] Expose status UI for laptop-side confidence.
- [x] Accept manifest from phone client.
- [x] Receive file uploads over local network.
- [x] Verify file size and SHA-256.
- [x] Write final transfer report.
- [x] Create Git repo for migration metadata.
- [x] Add smoke test with simulated phone client.
- [x] Add phone-friendly browser sender page.
- [x] Support browser uploads without precomputed hashes.

## Phase 2: Android Client

- [ ] Build native Kotlin app.
- [ ] Implement first-run pairing with laptop receiver.
- [ ] Implement storage preflight and permission health screen.
- [ ] Scan MediaStore for photos, videos, audio, and downloads.
- [ ] Add Storage Access Framework tree scan for user-selected roots.
- [ ] Add optional all-files access mode for private/off-Play distribution.
- [ ] Generate manifest before transfer.
- [ ] Upload files with progress, retry, and completion verification.
- [ ] Show explicit skipped/inaccessible areas so nothing is silently ignored.

## Phase 3: Migration Hardening

- [ ] Add resumable chunk upload protocol.
- [ ] Add laptop-to-phone manifest diff before sending files.
- [ ] Add USB fallback path.
- [ ] Add encrypted-at-rest backup option.
- [ ] Add restore/export viewer for completed backups.
