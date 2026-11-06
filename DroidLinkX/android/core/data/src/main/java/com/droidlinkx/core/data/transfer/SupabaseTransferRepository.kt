package com.droidlinkx.core.data.transfer

import android.content.Context
import android.net.Uri
import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.database.dao.TransferDao
import com.droidlinkx.core.database.entity.TransferFileEntity
import com.droidlinkx.core.database.entity.TransferQueueEntity
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.RemoteFile
import com.droidlinkx.core.domain.model.TransferItemProgress
import com.droidlinkx.core.domain.model.TransferPick
import com.droidlinkx.core.domain.model.TransferProgress
import com.droidlinkx.core.domain.repository.TransferRepository
import com.droidlinkx.core.network.di.OwnerTokenProvider
import com.droidlinkx.core.network.supabase.SupabaseConfig
import com.droidlinkx.core.network.supabase.SupabaseDownloadRequest
import com.droidlinkx.core.network.supabase.SupabaseFileRow
import com.droidlinkx.core.network.supabase.SupabaseFinalizeRequest
import com.droidlinkx.core.network.supabase.SupabaseFunctionsApi
import com.droidlinkx.core.network.supabase.SupabaseInitiateItem
import com.droidlinkx.core.network.supabase.SupabaseInitiateRequest
import com.droidlinkx.core.network.supabase.SupabaseRestApi
import com.droidlinkx.core.network.supabase.SupabaseStorageApi
import com.droidlinkx.core.network.supabase.SupabaseTransferRow
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.HttpException
import java.io.IOException
import java.io.InputStream
import java.net.URLEncoder
import java.security.MessageDigest
import java.time.Instant
import java.util.Collections
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Resumable uploads straight into Supabase Storage.
 *
 * The device holds only the owner JWT: parts are written under `‹owner›/‹transfer›/parts/...` where
 * Storage RLS pins the first path segment to `auth.uid()`. The `finalize-transfer` Edge Function
 * verifies the assembled size and SHA-256 before marking the item complete.
 */
@Singleton
class SupabaseTransferRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val rest: SupabaseRestApi,
    private val functions: SupabaseFunctionsApi,
    private val storage: SupabaseStorageApi,
    private val config: SupabaseConfig,
    private val dao: TransferDao,
    private val ownerToken: OwnerTokenProvider,
    private val scope: CoroutineScope,
) : TransferRepository {

    private val paused = Collections.synchronizedSet(mutableSetOf<String>())
    private val cancelled = Collections.synchronizedSet(mutableSetOf<String>())
    private val running = Collections.synchronizedSet(mutableSetOf<String>())
    private val remoteTransfers = MutableStateFlow<List<TransferProgress>>(emptyList())
    private val remoteFiles = MutableStateFlow<List<RemoteFile>>(emptyList())

    override fun observeTransfers(): Flow<List<TransferProgress>> =
        combine(dao.observeTransfers(), dao.observeAllFiles(), remoteTransfers) { queue, files, remote ->
            val local = queue.map { row ->
                val items = files.filter { it.transferId == row.transferId }
                    .sortedBy { it.itemIndex }
                    .map { file ->
                        TransferItemProgress(
                            index = file.itemIndex,
                            name = file.name,
                            size = file.size,
                            bytesSent = file.bytesSent,
                            status = file.status,
                            sha256 = file.sha256,
                            error = file.error,
                        )
                    }
                TransferProgress(
                    transferId = row.transferId,
                    direction = row.direction,
                    status = row.status,
                    totalBytes = row.totalBytes,
                    transferredBytes = row.transferredBytes,
                    items = items,
                    error = row.error,
                    createdAtEpochMillis = row.createdAtEpochMillis,
                )
            }
            val known = local.map { it.transferId }.toSet()
            (local + remote.filter { it.transferId !in known }).sortedByDescending { it.createdAtEpochMillis }
        }

    override fun observeRemoteFiles(): Flow<List<RemoteFile>> = remoteFiles.map { it }

    /* ------------------------------- uploads ------------------------------- */

    override suspend fun enqueue(picks: List<TransferPick>, targetDeviceId: String?): Outcome<String> {
        if (picks.isEmpty()) return Outcome.Failure("Select at least one file", code = "EMPTY")
        return runCatchingOutcome {
            val total = picks.sumOf { it.size }
            val request = SupabaseInitiateRequest(
                direction = "device_to_cloud",
                mode = "relay",
                sourceDeviceId = null,
                targetDeviceId = targetDeviceId,
                items = picks.map { pick ->
                    SupabaseInitiateItem(
                        name = pick.name,
                        size = pick.size,
                        sha256 = null,
                        relativePath = "/${pick.name}",
                    )
                },
            )
            val response = functions.initiateTransfer(request)
            val now = System.currentTimeMillis()
            val items = response.items.sortedBy { it.itemIndex }
            dao.upsertTransfer(
                TransferQueueEntity(
                    transferId = response.transfer.id,
                    direction = response.transfer.direction,
                    status = "queued",
                    totalBytes = total,
                    transferredBytes = 0,
                    chunkSize = response.chunkSize,
                    targetDeviceId = targetDeviceId,
                    error = null,
                    createdAtEpochMillis = now,
                    updatedAtEpochMillis = now,
                ),
            )
            dao.upsertFiles(
                items.mapIndexed { position, item ->
                    val pick = picks.getOrNull(position) ?: picks.last()
                    TransferFileEntity(
                        id = item.id,
                        transferId = response.transfer.id,
                        itemIndex = item.itemIndex,
                        name = item.name,
                        size = item.size,
                        contentUri = pick.uri,
                        sha256 = null,
                        status = "queued",
                        bytesSent = 0,
                        chunksSent = 0,
                        error = null,
                        updatedAtEpochMillis = now,
                    )
                },
            )
            scope.launch { runUpload(response.transfer.id) }
            response.transfer.id
        }
    }

    private suspend fun runUpload(transferId: String) {
        if (!running.add(transferId)) return
        try {
            val now = System.currentTimeMillis()
            dao.setTransferState(transferId, "running", null, now)
            runCatching {
                rest.patchTransfer(
                    transferId,
                    mapOf("status" to "active", "started_at" to Instant.now().toString()),
                )
            }
            val files = dao.files(transferId)
            var completedBytes = 0L
            for (file in files) {
                if (transferId in cancelled) return
                awaitIfPaused(transferId)
                uploadOne(transferId, file, completedBytes)
                completedBytes += file.size
            }
            dao.setTransferState(transferId, "completed", null, System.currentTimeMillis())
            runCatching { rest.patchTransfer(transferId, mapOf("status" to "completed")) }
            DroidLog.i(message = "Transfer $transferId completed")
        } catch (cancelledError: TransferCancelled) {
            dao.setTransferState(transferId, "cancelled", null, System.currentTimeMillis())
        } catch (t: Throwable) {
            DroidLog.w(message = "Transfer $transferId failed: ${t.message}")
            dao.setTransferState(transferId, "failed", t.message ?: "Transfer failed", System.currentTimeMillis())
            runCatching { dao.files(transferId).forEach { dao.setFileError(it.id, "failed", t.message, System.currentTimeMillis()) } }
        } finally {
            running.remove(transferId)
            paused.remove(transferId)
            cancelled.remove(transferId)
        }
    }

    private suspend fun uploadOne(transferId: String, file: TransferFileEntity, completedBytes: Long) {
        val uri = Uri.parse(file.contentUri)
        val digest = withContext(Dispatchers.IO) { sha256(uri) }
        val chunkSize = CHUNK_SIZE_BYTES.toInt()
        val ownerId = ownerId()
        val partsPath = { part: Int -> "$ownerId/$transferId/parts/${file.itemIndex}/$part.part" }

        var chunksSent = file.chunksSent
        var sentBytes = (chunksSent.toLong() * chunkSize).coerceAtMost(file.size)

        val input = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri) }
            ?: throw IOException("The selected file can no longer be read")
        input.use { stream ->
            withContext(Dispatchers.IO) { skipFully(stream, sentBytes) }
            val buffer = ByteArray(chunkSize)
            while (true) {
                awaitIfPaused(transferId)
                if (transferId in cancelled) throw TransferCancelled()
                val read = withContext(Dispatchers.IO) { readInto(stream, buffer) }
                if (read <= 0) break
                val bytes = if (read == buffer.size) buffer.copyOf() else buffer.copyOf(read)
                putPart(partsPath(chunksSent), bytes)
                chunksSent += 1
                sentBytes += read
                val now = System.currentTimeMillis()
                persistProgress(transferId, file, sentBytes, chunksSent, digest, completedBytes, now)
            }
        }

        val finalized = functions.finalizeTransfer(
            SupabaseFinalizeRequest(transferId = transferId, itemIndex = file.itemIndex, sha256 = digest),
        )
        val now = System.currentTimeMillis()
        dao.updateFileProgress(file.id, file.size, chunksSent, "completed", digest, now)
        dao.setTransferred(transferId, completedBytes + file.size, now)
        DroidLog.i(message = "Item ${file.name} verified=${finalized.checksumVerified}")
    }

    private suspend fun persistProgress(
        transferId: String,
        file: TransferFileEntity,
        bytesSent: Long,
        chunksSent: Int,
        sha256: String?,
        completedBytes: Long,
        now: Long,
    ) {
        dao.updateFileProgress(file.id, bytesSent, chunksSent, "uploading", sha256, now)
        dao.setTransferred(transferId, completedBytes + bytesSent, now)
        runCatching {
            rest.patchItem(
                transferId,
                file.itemIndex,
                mapOf(
                    "bytes_received" to bytesSent,
                    "received_chunks" to chunksSent,
                    "status" to "uploading",
                    "sha256" to sha256,
                ),
            )
        }
    }

    private suspend fun putPart(path: String, bytes: ByteArray) {
        val encoded = path.split('/').joinToString("/") { URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
        val url = "${config.baseUrl}storage/v1/object/droidlinkx-transfers/$encoded"
        storage.putObject(
            url = url,
            body = bytes.toRequestBody("application/octet-stream".toMediaType()),
            upsert = "true",
            contentType = "application/octet-stream",
        ).close()
    }

    private fun ownerId(): String {
        val token = ownerToken.ownerToken()
        val fromToken = token?.split('.')?.getOrNull(1)?.let { payload ->
            runCatching {
                val decoded = android.util.Base64.decode(
                    payload,
                    android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING,
                )
                org.json.JSONObject(String(decoded)).optString("sub")
            }.getOrNull()
        }
        if (!fromToken.isNullOrBlank()) return fromToken
        throw IOException("Sign in again: the transfer path could not be scoped to your account")
    }

    /* ------------------------------ controls ------------------------------- */

    override suspend fun pause(transferId: String): Outcome<Unit> = runCatchingOutcome {
        paused.add(transferId)
        dao.setTransferState(transferId, "paused", null, System.currentTimeMillis())
        runCatching { rest.patchTransfer(transferId, mapOf("status" to "paused")) }
    }

    override suspend fun resume(transferId: String): Outcome<Unit> = runCatchingOutcome {
        paused.remove(transferId)
        dao.setTransferState(transferId, "queued", null, System.currentTimeMillis())
        scope.launch { runUpload(transferId) }
    }

    override suspend fun cancel(transferId: String): Outcome<Unit> = runCatchingOutcome {
        cancelled.add(transferId)
        dao.setTransferState(transferId, "cancelled", null, System.currentTimeMillis())
        runCatching { rest.patchTransfer(transferId, mapOf("status" to "cancelled")) }
    }

    override suspend fun resumePending() {
        runCatching { refresh() }
        runCatching {
            dao.pendingTransfers().filter { it.status != "paused" }.forEach { row ->
                scope.launch { runUpload(row.transferId) }
            }
        }
    }

    /* ------------------------------- reading ------------------------------- */

    override suspend fun refresh(): Outcome<Unit> = runCatchingOutcome {
        remoteFiles.value = rest.files().map { it.toDomain() }
        remoteTransfers.value = rest.transfers().map { it.toProgress() }
    }

    override suspend fun secureDownload(fileId: String): Outcome<String> = runCatchingOutcome {
        functions.download(SupabaseDownloadRequest(fileId)).url
    }

    override suspend fun deleteRemoteFile(fileId: String): Outcome<Unit> = runCatchingOutcome {
        rest.deleteFile(fileId)
        Unit
    }

    /* ------------------------------- helpers ------------------------------- */

    private suspend fun awaitIfPaused(transferId: String) {
        while (transferId in paused) {
            if (transferId in cancelled) throw TransferCancelled()
            delay(400)
        }
    }

    private suspend fun sha256(uri: Uri): String {
        val digest = MessageDigest.getInstance("SHA-256")
        context.contentResolver.openInputStream(uri)?.use { input ->
            val buffer = ByteArray(HASH_BUFFER_BYTES)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        } ?: throw IOException("The selected file could not be opened")
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun readInto(input: InputStream, buffer: ByteArray): Int {
        var offset = 0
        while (offset < buffer.size) {
            val read = input.read(buffer, offset, buffer.size - offset)
            if (read < 0) break
            offset += read
        }
        return offset
    }

    private fun skipFully(input: InputStream, bytes: Long) {
        var remaining = bytes
        while (remaining > 0) {
            val skipped = input.skip(remaining)
            if (skipped > 0) {
                remaining -= skipped
            } else if (input.read() < 0) {
                return
            } else {
                remaining -= 1
            }
        }
    }

    private fun SupabaseFileRow.toDomain(): RemoteFile = RemoteFile(
        id = id,
        name = name,
        size = size,
        mimeType = mimeType ?: "application/octet-stream",
        category = category ?: "document",
        sha256 = sha256,
        deviceId = deviceId,
        createdAt = createdAt,
    )

    private fun SupabaseTransferRow.toProgress(): TransferProgress = TransferProgress(
        transferId = id,
        direction = direction,
        status = status,
        totalBytes = totalBytes,
        transferredBytes = transferredBytes,
        items = items.sortedBy { it.itemIndex }.map { item ->
            TransferItemProgress(
                index = item.itemIndex,
                name = item.name,
                size = item.size,
                bytesSent = item.bytesReceived,
                status = item.status,
                sha256 = item.sha256,
                error = item.error,
            )
        },
        error = error,
        createdAtEpochMillis = createdAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: 0L,
    )

    private suspend inline fun <T> runCatchingOutcome(block: suspend () -> T): Outcome<T> = try {
        Outcome.Success(block())
    } catch (http: HttpException) {
        Outcome.Failure(httpMessage(http), code = "HTTP_${http.code()}", httpStatus = http.code(), cause = http)
    } catch (io: IOException) {
        Outcome.Failure(io.message ?: "The network request failed", code = "NETWORK", cause = io)
    } catch (t: Throwable) {
        Outcome.Failure(t.message ?: "The transfer failed", code = "TRANSFER", cause = t)
    }

    private fun httpMessage(http: HttpException): String = when (http.code()) {
        401 -> "Your session expired. Sign in again."
        403 -> "This action is not allowed for your account."
        404 -> "The requested item no longer exists."
        409 -> "The server rejected this transfer."
        413 -> "This file is larger than the server accepts."
        else -> "The server returned HTTP ${http.code()}."
    }

    private class TransferCancelled : RuntimeException("Transfer cancelled")

    companion object {
        const val CHUNK_SIZE_BYTES: Long = 8L * 1024 * 1024
        private const val HASH_BUFFER_BYTES = 256 * 1024
    }
}
