package com.oneshotphonetransfer.storage

import android.net.Uri

enum class DiscoveredFileCategory {
    PHOTO,
    VIDEO,
    AUDIO,
    DOCUMENT,
    DOWNLOAD,
    ARCHIVE,
    OTHER
}

data class DiscoveredFile(
    val sourceUri: Uri,
    val relativePath: String,
    val displayPath: String,
    val size: Long,
    val modifiedAtMillis: Long?,
    val mimeType: String?,
    val category: DiscoveredFileCategory
)

data class StoragePreflightResult(
    val canReadMedia: Boolean,
    val grantedTreeRoots: List<Uri>,
    val inaccessible: List<String>
)

