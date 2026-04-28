# Transfer Protocol v1

The first implementation uses simple local HTTP. All authenticated calls use:

```text
Authorization: Bearer <token>
```

The receiver also serves a browser client at:

```http
GET /send
```

That page uses the same API below.

## Pair

```http
POST /api/pair
Content-Type: application/json

{
  "deviceName": "Ashish Pixel",
  "pairingCode": "123456"
}
```

Response:

```json
{
  "sessionId": "uuid",
  "token": "secret",
  "receiverName": "Ashish-Laptop",
  "maxUploadBytes": 10737418240
}
```

## Send Manifest

```http
POST /api/manifest
Authorization: Bearer <token>
Content-Type: application/json
```

Body follows `protocol/manifest.v1.schema.json`.

Response:

```json
{
  "ok": true,
  "expectedFiles": 2,
  "expectedBytes": 1536
}
```

## Upload File

```http
PUT /api/files?path=DCIM%2FCamera%2Fphoto.jpg
Authorization: Bearer <token>
X-File-Size: 1024
X-File-Sha256: <hex sha256>
X-Modified-At: 2026-04-28T15:30:00.000Z
Content-Type: application/octet-stream
```

`X-File-Sha256` is optional for browser uploads where hashing a large file before sending would create poor memory pressure. The receiver still computes the received SHA-256 and verifies size.

Response:

```json
{
  "ok": true,
  "path": "DCIM/Camera/photo.jpg",
  "hostPath": "DCIM/Camera/photo.jpg",
  "bytes": 1024,
  "sha256": "<hex sha256>"
}
```

## Complete

```http
POST /api/complete
Authorization: Bearer <token>
Content-Type: application/json

{
  "clientFinishedAt": "2026-04-28T15:45:00.000Z"
}
```

Response includes final verification summary and report path.

## Future Chunked Upload

The v1 receiver accepts whole-file uploads. The next protocol increment should add:

- `POST /api/files/start`
- `PUT /api/files/chunks`
- `POST /api/files/finish`

That will support resume for very large videos and flaky Wi-Fi.
