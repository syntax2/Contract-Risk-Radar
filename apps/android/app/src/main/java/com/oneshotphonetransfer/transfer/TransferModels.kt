package com.oneshotphonetransfer.transfer

data class DeviceInfo(
    val id: String?,
    val name: String,
    val androidVersion: String?,
    val model: String?
)

data class ManifestRoot(
    val label: String,
    val path: String,
    val accessMode: String
)

data class InaccessiblePath(
    val path: String,
    val reason: String
)

data class TransferFile(
    val id: String?,
    val relativePath: String,
    val displayPath: String?,
    val sourceUri: String?,
    val size: Long,
    val modifiedAt: String?,
    val sha256: String?,
    val mimeType: String?,
    val category: String
)

data class TransferManifest(
    val version: Int = 1,
    val createdAt: String,
    val device: DeviceInfo,
    val roots: List<ManifestRoot>,
    val inaccessible: List<InaccessiblePath>,
    val files: List<TransferFile>
)

data class PairResponse(
    val ok: Boolean,
    val sessionId: String,
    val token: String,
    val receiverName: String,
    val maxUploadBytes: Long
)

data class UploadResult(
    val ok: Boolean,
    val path: String,
    val hostPath: String,
    val bytes: Long,
    val sha256: String
)

