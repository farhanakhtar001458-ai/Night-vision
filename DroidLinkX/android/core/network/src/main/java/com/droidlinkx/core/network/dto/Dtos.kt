package com.droidlinkx.core.network.dto

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class UserDto(
    val id: String,
    val email: String,
    val displayName: String,
    val status: String? = null,
    val createdAt: String? = null,
    val lastLoginAt: String? = null,
)

@JsonClass(generateAdapter = true)
data class TokenPayloadDto(
    val accessToken: String,
    val expiresIn: Long,
    val refreshToken: String,
    val refreshExpiresIn: Long? = null,
    val tokenType: String? = "Bearer",
)

@JsonClass(generateAdapter = true)
data class AuthResponseDto(
    val user: UserDto,
    val tokens: TokenPayloadDto,
)

@JsonClass(generateAdapter = true)
data class RegisterRequestDto(
    val email: String,
    val password: String,
    val displayName: String,
)

@JsonClass(generateAdapter = true)
data class LoginRequestDto(
    val email: String,
    val password: String,
)

@JsonClass(generateAdapter = true)
data class RefreshRequestDto(val refreshToken: String)

@JsonClass(generateAdapter = true)
data class LogoutRequestDto(val refreshToken: String? = null)

@JsonClass(generateAdapter = true)
data class MeResponseDto(
    val user: UserDto,
    val counts: CountsDto? = null,
)

@JsonClass(generateAdapter = true)
data class CountsDto(val devices: Int = 0, val online: Int = 0)

@JsonClass(generateAdapter = true)
data class DeviceTelemetryDto(
    val battery: Int? = null,
    val charging: Boolean? = null,
    val network: String? = null,
    val ip: String? = null,
    val storageFreeBytes: Long? = null,
    val storageTotalBytes: Long? = null,
    val ramUsedBytes: Long? = null,
    val ramTotalBytes: Long? = null,
    val cpu: String? = null,
    val screenResolution: String? = null,
    val uptimeSeconds: Long? = null,
    val batteryTemperatureC: Double? = null,
    val latencyMs: Long? = null,
)

@JsonClass(generateAdapter = true)
data class DeviceDto(
    val id: String,
    val name: String,
    val manufacturer: String? = null,
    val model: String? = null,
    val androidVersion: String? = null,
    val sdkInt: Int? = null,
    val appVersion: String? = null,
    val platform: String? = null,
    val status: String? = null,
    val trusted: Boolean = false,
    val online: Boolean = false,
    val connectionQuality: String? = null,
    val lastSeenAt: String? = null,
    val createdAt: String? = null,
    val telemetry: Map<String, Any?> = emptyMap(),
    val permissions: Map<String, Boolean> = emptyMap(),
)

@JsonClass(generateAdapter = true)
data class DeviceListDto(val devices: List<DeviceDto>)

@JsonClass(generateAdapter = true)
data class DeviceEnvelopeDto(val device: DeviceDto)

@JsonClass(generateAdapter = true)
data class EnrollRequestDto(
    val name: String,
    val manufacturer: String? = null,
    val model: String? = null,
    val androidVersion: String? = null,
    val sdkInt: Int? = null,
    val appVersion: String? = null,
    val platform: String = "android",
)

@JsonClass(generateAdapter = true)
data class EnrollResponseDto(
    val device: DeviceDto,
    val deviceId: String,
    val deviceSecret: String,
    val wsUrl: String,
)

@JsonClass(generateAdapter = true)
data class DeviceTokenRequestDto(
    val deviceId: String,
    val deviceSecret: String,
)

@JsonClass(generateAdapter = true)
data class DeviceTokenResponseDto(
    val accessToken: String,
    val expiresIn: Long,
    val tokenType: String? = "Bearer",
    val device: DeviceDto,
    val wsUrl: String,
    val sessionId: String,
)

@JsonClass(generateAdapter = true)
data class DeviceStatusRequestDto(
    val telemetry: Map<String, Any>,
    val name: String? = null,
)

@JsonClass(generateAdapter = true)
data class UpdateDeviceRequestDto(
    val name: String? = null,
    val trusted: Boolean? = null,
)

@JsonClass(generateAdapter = true)
data class PermissionRequestDto(val granted: Boolean)

@JsonClass(generateAdapter = true)
data class PermissionResponseDto(val permissions: Map<String, Boolean>)

@JsonClass(generateAdapter = true)
data class ConnectionCreateRequestDto(
    val sourceDeviceId: String,
    val targetDeviceId: String? = null,
    val type: String,
)

@JsonClass(generateAdapter = true)
data class ConnectionDto(
    val id: String,
    val sourceDeviceId: String,
    val targetDeviceId: String? = null,
    val type: String,
    val status: String,
    val requestedBy: String? = null,
    val createdAt: String? = null,
    val expiresAt: String? = null,
    val turn: TurnCredentialsDto? = null,
)

@JsonClass(generateAdapter = true)
data class ConnectionEnvelopeDto(val connection: ConnectionDto)

@JsonClass(generateAdapter = true)
data class ConnectionStatusDto(
    val connections: List<ConnectionDto> = emptyList(),
    val config: SignalingConfigDto? = null,
)

@JsonClass(generateAdapter = true)
data class SignalingConfigDto(
    val turnConfigured: Boolean = false,
    val stunUrls: List<String> = emptyList(),
    val turnUrls: List<String> = emptyList(),
)

@JsonClass(generateAdapter = true)
data class TurnCredentialsDto(
    val urls: List<String> = emptyList(),
    val username: String = "",
    val credential: String = "",
    val ttl: Long = 0,
)

@JsonClass(generateAdapter = true)
data class IceServersDto(
    val iceServers: List<Map<String, Any?>> = emptyList(),
    val ttl: Long? = null,
)

@JsonClass(generateAdapter = true)
data class TerminateConnectionRequestDto(
    val connectionId: String,
    val reason: String? = null,
)

@JsonClass(generateAdapter = true)
data class ConnectionHistoryEntryDto(
    val id: String,
    val connectionId: String? = null,
    val event: String,
    val detail: Map<String, Any?> = emptyMap(),
    val createdAt: String,
)

@JsonClass(generateAdapter = true)
data class ConnectionHistoryDto(val events: List<ConnectionHistoryEntryDto>)

@JsonClass(generateAdapter = true)
data class ApiErrorDto(val error: ApiErrorBodyDto? = null)

@JsonClass(generateAdapter = true)
data class ApiErrorBodyDto(
    val code: String? = null,
    val message: String? = null,
    val details: Any? = null,
)
