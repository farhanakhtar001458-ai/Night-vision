package com.droidlinkx.core.domain.model

/* ------------------------------- owner ------------------------------- */

data class OwnerProfile(
    val id: String,
    val email: String,
    val displayName: String,
)

data class OwnerTokens(
    val accessToken: String,
    val refreshToken: String,
    val accessExpiresAtEpochMillis: Long,
)

data class OwnerSession(
    val profile: OwnerProfile,
    val tokens: OwnerTokens,
)

/* ------------------------------ devices ------------------------------ */

data class DeviceTelemetry(
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
) {
    /** Wire representation of the telemetry report posted to `POST /api/devices/:id/status`. */
    fun toWireMap(): Map<String, Any> = buildMap {
        battery?.let { put("battery", it) }
        charging?.let { put("charging", it) }
        network?.let { put("network", it) }
        ip?.let { put("ip", it) }
        storageFreeBytes?.let { put("storageFreeBytes", it) }
        storageTotalBytes?.let { put("storageTotalBytes", it) }
        ramUsedBytes?.let { put("ramUsedBytes", it) }
        ramTotalBytes?.let { put("ramTotalBytes", it) }
        cpu?.let { put("cpu", it) }
        screenResolution?.let { put("screenResolution", it) }
        uptimeSeconds?.let { put("uptimeSeconds", it) }
        batteryTemperatureC?.let { put("batteryTemperatureC", it) }
        latencyMs?.let { put("latencyMs", it) }
    }
}

data class Device(
    val id: String,
    val name: String,
    val manufacturer: String?,
    val model: String?,
    val androidVersion: String?,
    val sdkInt: Int?,
    val appVersion: String?,
    val online: Boolean,
    val trusted: Boolean,
    val connectionQuality: String,
    val lastSeenAt: String?,
    val telemetry: DeviceTelemetry,
    val permissions: Map<String, Boolean>,
) {
    val displayModel: String
        get() = listOfNotNull(manufacturer, model).joinToString(" ").ifBlank { "Android device" }
}

data class EnrolledDevice(
    val deviceId: String,
    val secret: String,
    val name: String,
    val wsUrl: String,
    val enrolledAtEpochMillis: Long = System.currentTimeMillis(),
)

/* ---------------------------- connectivity ---------------------------- */

enum class LinkState { Disconnected, Connecting, Authenticated, Reconnecting, AuthorizationFailed }

data class LinkStatus(
    val state: LinkState = LinkState.Disconnected,
    val attempt: Int = 0,
    val lastError: String? = null,
    val sinceEpochMillis: Long = System.currentTimeMillis(),
) {
    val isHealthy: Boolean get() = state == LinkState.Authenticated
}

sealed interface RealtimeEvent {
    val raw: Map<String, Any?>?

    data class DeviceOnline(val deviceId: String, override val raw: Map<String, Any?>) : RealtimeEvent
    data class DeviceOffline(val deviceId: String, override val raw: Map<String, Any?>) : RealtimeEvent
    data class DeviceHeartbeat(val deviceId: String, val battery: Int?, val charging: Boolean?, val network: String?, override val raw: Map<String, Any?>) : RealtimeEvent
    data class ConnectionRequested(val connectionId: String, val type: String, val fromId: String?, override val raw: Map<String, Any?>) : RealtimeEvent
    data class ConnectionAccepted(val connectionId: String, override val raw: Map<String, Any?>) : RealtimeEvent
    data class ConnectionRejected(val connectionId: String, val reason: String?, override val raw: Map<String, Any?>) : RealtimeEvent
    data class ConnectionEnded(val connectionId: String, val reason: String?, override val raw: Map<String, Any?>) : RealtimeEvent
    data class RtcOffer(val connectionId: String, val sdp: String, override val raw: Map<String, Any?>) : RealtimeEvent
    data class RtcAnswer(val connectionId: String, val sdp: String, override val raw: Map<String, Any?>) : RealtimeEvent
    data class RtcIce(val connectionId: String, val candidate: String, val sdpMid: String?, val sdpMLineIndex: Int?, override val raw: Map<String, Any?>) : RealtimeEvent
    data class TransferProgress(val transferId: String, val bytes: Long, val total: Long?, override val raw: Map<String, Any?>) : RealtimeEvent
    data class ServerHello(val role: String?, val heartbeatIntervalMs: Long?, override val raw: Map<String, Any?>) : RealtimeEvent
    data class ServerError(val code: String?, val message: String?, override val raw: Map<String, Any?>) : RealtimeEvent
    data class Unknown(val type: String, override val raw: Map<String, Any?>) : RealtimeEvent
}

/* ------------------------------ startup ------------------------------ */

enum class InitializationStep {
    Idle,
    GeneratingIdentity,
    SecuringCredentials,
    PreparingDatabase,
    PreparingNetwork,
    PreparingCloudLink,
    CheckingConnectivity,
    RegisteringDevice,
    OpeningSocket,
    Ready,
    WaitingForOwner,
    Failed,
}

data class InitializationState(
    val step: InitializationStep = InitializationStep.Idle,
    val message: String? = null,
    val fingerprint: String? = null,
)
