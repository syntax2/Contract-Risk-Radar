# Architecture

## Goal

Move user-accessible Android local files to a laptop in a single, smooth migration where the user can trust that every accessible file was either copied, verified, or explicitly reported as inaccessible.

The system is not a sync product. It is a migration appliance.

## Components

### Android Client

Responsibilities:

- Pair with the laptop receiver.
- Run storage permission preflight.
- Scan accessible storage roots.
- Build a manifest before transfer.
- Upload files to the receiver.
- Display clear progress, retry, and final verification states.

Storage sources:

- `MediaStore` for indexed photos, videos, audio, and common media.
- Storage Access Framework tree access for folders the user grants.
- Optional all-files access for personal/private builds where policy allows it.

Android app-private data such as other apps' internal databases is not generally accessible to a normal app. The product must say that clearly instead of implying impossible coverage.

### Laptop Receiver

Responsibilities:

- Run locally on the laptop.
- Show pairing code and local network URLs.
- Receive manifest and files.
- Preserve source folder structure as safely as possible on the host OS.
- Verify received files by byte count and SHA-256 when supplied.
- Write transfer reports.
- Create a Git repository for metadata.

Default backup layout:

```text
phone-transfer-backups/
  phone-migration-2026-04-28_21-30-00/
    .git/
    README.md
    manifest.json
    host-path-map.json
    transfer-report.json
    files/
      DCIM/
      Downloads/
      Documents/
    tmp/
```

By default, `files/` is ignored by Git. The repo captures migration evidence without forcing large binary media into Git history.

### Browser Sender

The receiver serves `/send`, a phone-friendly browser sender. It lets the user open the laptop's Wi-Fi URL on Android, pair with the receiver, select files or a folder, upload them, and complete the same manifest/report flow.

Browser mode cannot read the entire phone automatically. It is useful now because it gives the project a working migration path while the native Android scanner is built.

## Pairing

The laptop prints a one-time numeric pairing code and shows it in the local UI. The Android app sends the code to `/api/pair`, receives a bearer token, and uses that token for manifest and file upload calls.

This is enough for trusted local Wi-Fi migration. A later hardening phase can add QR pairing with pinned public keys.

## Completeness Model

The product should avoid pretending Android allows perfect access to everything. The stronger promise is:

1. Every accessible file discovered by the scanner is listed in the manifest.
2. Every manifest file is copied or listed as missing/failed.
3. Every copied file is verified by size and, when available, SHA-256.
4. Every inaccessible storage area is listed in the final app report.

That gives the user a complete migration story instead of a vague "done".

## Transfer Flow

1. Laptop receiver starts and creates a migration folder.
2. User opens the browser sender or Android app and pairs with laptop.
3. Client runs permission or selection preflight.
4. Client scans or lists selected files and creates manifest.
5. Client sends manifest to receiver.
6. Receiver maps Android paths to safe host paths.
7. Android app uploads files.
8. Receiver verifies each upload.
9. Android app calls complete.
10. Receiver verifies the whole manifest, writes report, and creates Git metadata repo.

## Why Not Commit All Files To Git By Default

Git is poor for giant binary sets such as photos and videos. A normal phone migration can be tens or hundreds of gigabytes. The safer default is:

- Actual files live plainly in `files/`.
- Git tracks manifests, reports, and path maps.
- The backup remains easy to browse and copy.

For small migrations, the receiver supports `--track-files`.
