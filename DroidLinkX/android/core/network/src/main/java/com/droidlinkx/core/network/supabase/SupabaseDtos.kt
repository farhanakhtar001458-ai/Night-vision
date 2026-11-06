package com.droidlinkx.core.network.supabase

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/* --------------------------------- auth --------------------------------- */

@JsonClass(generateAdapter = true)
data class SupabaseUserDto(
    val id: String,
    val email: String? = null,
    @Json(name = "user_metadata") val userMetadata: Map<String, Any?> = emptyMap(),
    @Json(name = "created_at") val createdAt: String? = null,
    @Json(name = "last_sign_in_at") val lastSignInAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseSessionDto(
    @Json(name = "access_token") val accessToken: String = "",
    @Json(name = "refresh_token") val refreshToken: String = "",
    @Json(name = "expires_in") val expiresIn: Long = 3600,
    @Json(name = "token_type") val tokenType: String? = "bearer",
    val user: SupabaseUserDto? = null,
)

@JsonClass(generateAdapter = true)
data class SupabasePasswordRequest(
    val email: String,
    val password: String,
)

@JsonClass(generateAdapter = true)
data class SupabaseRefreshRequest(
    @Json(name = "refresh_token") val refreshToken: String,
)

@JsonClass(generateAdapter = true)
data class SupabaseSignUpRequest(
    val email: String,
    val password: String,
    val data: Map<String, Any?> = emptyMap(),
)

/* ------------------------------- postgrest ------------------------------- */

@JsonClass(generateAdapter = true)
data class SupabasePermissionRow(
    val permission: String,
    val granted: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class SupabaseDeviceRow(
    val id: String,
    val name: String,
    val manufacturer: String? = null,
    val model: String? = null,
    @Json(name = "android_version") val androidVersion: String? = null,
    @Json(name = "sdk_int") val sdkInt: Int? = null,
    @Json(name = "app_version") val appVersion: String? = null,
    val platform: String? = null,
    val status: String? = null,
    val trusted: Boolean = false,
    val online: Boolean = false,
    @Json(name = "connection_quality") val connectionQuality: String? = null,
    @Json(name = "last_seen_at") val lastSeenAt: String? = null,
    @Json(name = "created_at") val createdAt: String? = null,
    val telemetry: Map<String, Any?> = emptyMap(),
    @Json(name = "device_permissions") val permissions: List<SupabasePermissionRow> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class SupabaseConnectionRow(
    val id: String,
    @Json(name = "source_device_id") val sourceDeviceId: String,
    @Json(name = "target_device_id") val targetDeviceId: String? = null,
    val type: String = "mirror",
    val status: String = "pending",
    @Json(name = "requested_by") val requestedBy: String? = null,
    @Json(name = "created_at") val createdAt: String? = null,
    @Json(name = "expires_at") val expiresAt: String? = null,
    @Json(name = "accepted_at") val acceptedAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseEventRow(
    val id: String,
    @Json(name = "connection_id") val connectionId: String? = null,
    val event: String,
    val detail: Map<String, Any?> = emptyMap(),
    @Json(name = "created_at") val createdAt: String,
)

@JsonClass(generateAdapter = true)
data class SupabaseProfileRow(
    val id: String,
    val email: String? = null,
    @Json(name = "display_name") val displayName: String? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseFileRow(
    val id: String,
    val name: String,
    val path: String? = null,
    val size: Long = 0,
    @Json(name = "mime_type") val mimeType: String? = null,
    val category: String? = null,
    val sha256: String? = null,
    @Json(name = "storage_path") val storagePath: String? = null,
    @Json(name = "device_id") val deviceId: String? = null,
    @Json(name = "created_at") val createdAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseTransferRow(
    val id: String,
    val direction: String = "dashboard_to_device",
    val mode: String = "relay",
    val status: String = "pending",
    @Json(name = "source_device_id") val sourceDeviceId: String? = null,
    @Json(name = "target_device_id") val targetDeviceId: String? = null,
    @Json(name = "total_bytes") val totalBytes: Long = 0,
    @Json(name = "transferred_bytes") val transferredBytes: Long = 0,
    @Json(name = "item_count") val itemCount: Int = 0,
    @Json(name = "completed_items") val completedItems: Int = 0,
    val error: String? = null,
    @Json(name = "created_at") val createdAt: String? = null,
    @Json(name = "transfer_items") val items: List<SupabaseTransferItemRow> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class SupabaseTransferItemRow(
    val id: String,
    @Json(name = "transfer_id") val transferId: String? = null,
    @Json(name = "item_index") val itemIndex: Int = 0,
    val name: String = "file",
    @Json(name = "relative_path") val relativePath: String? = null,
    val size: Long = 0,
    val sha256: String? = null,
    val status: String = "pending",
    @Json(name = "bytes_received") val bytesReceived: Long = 0,
    @Json(name = "received_chunks") val receivedChunks: Int = 0,
    @Json(name = "checksum_verified") val checksumVerified: Boolean = false,
    @Json(name = "storage_path") val storagePath: String? = null,
    val error: String? = null,
)

/* -------------------------------- functions ------------------------------ */

@JsonClass(generateAdapter = true)
data class SupabaseSignalingDto(
    @Json(name = "signalingUrl") val signalingUrl: String? = null,
    @Json(name = "stunUrls") val stunUrls: List<String> = emptyList(),
    @Json(name = "turnUrls") val turnUrls: List<String> = emptyList(),
    @Json(name = "turnConfigured") val turnConfigured: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class SupabaseEnrollRequest(
    val name: String,
    val manufacturer: String? = null,
    val model: String? = null,
    val androidVersion: String? = null,
    val sdkInt: Int? = null,
    val appVersion: String? = null,
    val platform: String = "android",
)

@JsonClass(generateAdapter = true)
data class SupabaseEnrollResponse(
    val device: SupabaseDeviceRow,
    val deviceId: String,
    val deviceSecret: String,
    val permissions: Map<String, Boolean> = emptyMap(),
    val signaling: SupabaseSignalingDto? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseRevokeRequest(
    val deviceId: String,
    val delete: Boolean = true,
    val sessionsOnly: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class SupabaseRevokeResponse(
    val revoked: Boolean = false,
    @Json(name = "sessionsRevoked") val sessionsRevoked: Int = 0,
)

@JsonClass(generateAdapter = true)
data class SupabaseCreateSessionRequest(
    val deviceId: String,
    val deviceSecret: String,
    val userAgent: String? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseCreateSessionResponse(
    val accessToken: String,
    @Json(name = "tokenType") val tokenType: String? = "Bearer",
    val expiresIn: Long = 0,
    val sessionId: String,
    val device: SupabaseDeviceRow? = null,
    val signaling: SupabaseSignalingDto? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseAuthorizeRequest(
    val sourceDeviceId: String? = null,
    val targetDeviceId: String? = null,
    val type: String? = null,
    val connectionId: String? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseAuthorizeResponse(
    val connection: SupabaseConnectionRow,
    val iceServers: List<Map<String, Any?>> = emptyList(),
    val ttl: Long? = null,
    val signaling: SupabaseSignalingDto? = null,
    val reused: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class SupabaseInitiateItem(
    val name: String,
    val size: Long,
    val sha256: String? = null,
    val relativePath: String? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseInitiateRequest(
    val direction: String,
    val mode: String = "relay",
    val sourceDeviceId: String? = null,
    val targetDeviceId: String? = null,
    val items: List<SupabaseInitiateItem>,
)

@JsonClass(generateAdapter = true)
data class SupabaseUploadTarget(
    val index: Int = 0,
    val storagePath: String? = null,
    val path: String? = null,
    val token: String? = null,
    val signedUrl: String? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseInitiateResponse(
    val transfer: SupabaseTransferRow,
    val items: List<SupabaseTransferItemRow> = emptyList(),
    val uploadTargets: List<SupabaseUploadTarget> = emptyList(),
    val bucket: String = "droidlinkx-transfers",
    val chunkSize: Long = 8L * 1024 * 1024,
)

@JsonClass(generateAdapter = true)
data class SupabaseFinalizeRequest(
    val transferId: String,
    val itemIndex: Int,
    val sha256: String? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseFinalizeResponse(
    val transfer: SupabaseTransferRow,
    val itemId: String? = null,
    val bytes: Long = 0,
    val sha256: String? = null,
    @Json(name = "checksumVerified") val checksumVerified: Boolean = false,
)

@JsonClass(generateAdapter = true)
data class SupabaseDownloadRequest(val fileId: String)

@JsonClass(generateAdapter = true)
data class SupabaseDownloadResponse(
    val url: String,
    val name: String? = null,
    @Json(name = "mimeType") val mimeType: String? = null,
    val expiresAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseStatusRequest(
    val deviceId: String? = null,
    val telemetry: Map<String, Any> = emptyMap(),
    val name: String? = null,
)

@JsonClass(generateAdapter = true)
data class SupabaseStatusResponse(
    val ok: Boolean = false,
    val serverTime: Long = 0,
    val deviceId: String? = null,
)
