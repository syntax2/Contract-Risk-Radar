# OneShot Phone Transfer

OneShot Phone Transfer is a local-first Android-to-laptop migration tool for a mostly one-time move of phone files onto a laptop.

The design favors completeness, verification, and a calm migration experience:

- The phone scans shared local storage and builds a manifest before upload.
- The laptop receives every file, verifies size and SHA-256 when available, and writes a transfer report.
- The backup folder becomes a local Git repository for migration metadata.
- Large media files are kept on disk as normal files by default, instead of being forced into Git history.

## Current Status

This repo now contains the first implementation slice:

- `apps/receiver`: a no-dependency Node.js laptop receiver with local web UI and HTTP API.
- `protocol`: the manifest contract used between Android and laptop.
- `docs`: architecture and implementation notes.

The Android app is intentionally next after the receiver because it needs stable receiver contracts.

## Run The Laptop Receiver

```powershell
node apps\receiver\src\server.js --port 47888
```

Then open the laptop UI shown in the terminal, usually:

```text
http://localhost:47888
```

Open the phone sender from the Android phone using the Wi-Fi URL shown by the receiver:

```text
http://<laptop-ip>:47888/send
```

The sender page lets you pair with the laptop code, choose files or a folder, upload them, and wait for the laptop verification report.

To store backups somewhere specific:

```powershell
node apps\receiver\src\server.js --port 47888 --out "D:\Phone migration"
```

By default, the generated Git repo tracks metadata and reports while leaving the copied files in `files/`. To put the copied files into Git too, use:

```powershell
node apps\receiver\src\server.js --track-files
```

Use `--track-files` only for small migrations. Git is not a good storage engine for large photo and video libraries.

## Smoke Test

```powershell
node apps\receiver\scripts\smoke-test.js
```

The smoke test starts the receiver, pairs, uploads hashed and browser-style files, completes the migration, and checks the transfer report.
