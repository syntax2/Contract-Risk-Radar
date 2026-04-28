# Android Client Plan

The Android client will be a native Kotlin app. The receiver is being built first so the Android code has a stable target.

## Primary UX

1. User starts the laptop receiver.
2. User opens the Android app.
3. App asks for the laptop URL and pairing code, later replaced by QR scan.
4. App runs a storage access preflight.
5. App shows a single primary action: `Transfer to Laptop`.
6. App scans accessible storage and sends the manifest.
7. App uploads files with progress and retry.
8. App shows final laptop verification status.

## Storage Strategy

Use layered discovery so the app maximizes coverage without lying:

- MediaStore for photos, videos, audio, and indexed files.
- Storage Access Framework tree picker for user-granted folders.
- Optional all-files access mode for personal/private distribution.

The app must report inaccessible areas explicitly. Android does not let a normal app read every other app's private storage.

## Initial Kotlin Modules

Planned modules:

- `storage/StoragePreflight.kt`: permission and access health.
- `storage/MediaStoreScanner.kt`: indexed media discovery.
- `storage/TreeScanner.kt`: SAF tree traversal.
- `transfer/ReceiverClient.kt`: pairing, manifest, upload, complete.
- `transfer/ManifestBuilder.kt`: stable manifest generation and hashing.
- `ui/MigrationScreen.kt`: one-button flow and progress.

## Completeness Rules

- A file must never disappear from UI state once discovered.
- Each discovered file ends as `verified`, `failed`, `skipped`, or `inaccessible`.
- The phone sends skipped/inaccessible data to the receiver so the final report is honest.
- The final success state comes from laptop verification, not from upload completion alone.

