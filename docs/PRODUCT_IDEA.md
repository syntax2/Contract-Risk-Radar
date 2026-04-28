# Product Idea

OneShot Phone Transfer is a guided migration app for moving Android files to a laptop over the same Wi-Fi network.

The practical promise is simple:

1. Start the laptop receiver.
2. Open the phone sender.
3. Pair with the code.
4. Choose files or a folder.
5. Send everything.
6. Review the laptop verification report.

The system should feel less like a developer tool and more like a migration desk: clear state, visible progress, explicit verification, and honest reporting when Android or browser permissions prevent full access.

## Practical Modes

### Browser Sender

Usable today. The user opens `/send` on the phone, selects files or a folder, and uploads through the same manifest/report protocol.

This is best for immediate transfers where the user can select the important folders manually.

### Native Android App

Built next. The native app should scan MediaStore, user-granted folders, and optional all-files access where appropriate.

This is best for the eventual one-button transfer experience.

## User Experience Principles

- Do not say "complete" until the laptop has verified the report.
- Do not hide inaccessible storage areas.
- Do not force large media files into Git history.
- Do not make the user understand network protocols.
- Always keep a readable backup folder and machine-readable manifest.

