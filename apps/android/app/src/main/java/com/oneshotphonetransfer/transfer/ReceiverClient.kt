package com.oneshotphonetransfer.transfer

import java.io.InputStream

interface ReceiverClient {
    suspend fun pair(
        receiverBaseUrl: String,
        deviceName: String,
        pairingCode: String
    ): PairResponse

    suspend fun sendManifest(
        token: String,
        manifest: TransferManifest
    )

    suspend fun uploadFile(
        token: String,
        file: TransferFile,
        input: InputStream,
        onBytesSent: (Long) -> Unit
    ): UploadResult

    suspend fun complete(
        token: String
    )
}

