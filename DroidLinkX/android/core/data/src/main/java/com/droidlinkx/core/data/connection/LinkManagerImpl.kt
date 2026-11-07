package com.droidlinkx.core.data.connection

import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.data.repository.SessionStorage
import com.droidlinkx.core.data.settings.DeviceSettingsRepositoryImpl
import com.droidlinkx.core.database.dao.ConnectionEventDao
import com.droidlinkx.core.database.dao.DeviceDao
import com.droidlinkx.core.database.entity.ConnectionEventEntity
import com.droidlinkx.core.domain.model.LinkState
import com.droidlinkx.core.domain.model.LinkStatus
import com.droidlinkx.core.domain.model.RealtimeEvent
import com.droidlinkx.core.domain.repository.DeviceCatalogueRepository
import com.droidlinkx.core.domain.repository.DeviceRegistrationRepository
import com.droidlinkx.core.domain.repository.LinkManager
import com.droidlinkx.core.domain.repository.TelemetryRepository
import com.droidlinkx.core.network.RealtimeSocket
import com.droidlinkx.core.network.supabase.SupabaseConfig
import com.droidlinkx.core.network.SocketEvent
import com.droidlinkx.core.network.SocketState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Owns the authenticated cloud link for this device:
 * credential refresh -> WebSocket handshake -> presence -> periodic telemetry/heartbeat.
 * Every reconnect is paced by the socket's backoff policy, so nothing spins in the background.
 */
@Singleton
class LinkManagerImpl @Inject constructor(
    private val socket: RealtimeSocket,
    private val scope: CoroutineScope,
    private val sessionStorage: SessionStorage,
    private val deviceRegistration: DeviceRegistrationRepository,
    private val telemetryRepository: TelemetryRepository,
    private val deviceCatalogue: DeviceCatalogueRepository,
    private val deviceDao: DeviceDao,
    private val connectionEventDao: ConnectionEventDao,
    private val settings: DeviceSettingsRepositoryImpl,
    private val supabaseConfig: SupabaseConfig,
) : LinkManager {

    private val _status = MutableStateFlow(LinkStatus())
    override val status: StateFlow<LinkStatus> = _status.asStateFlow()

    private val _events = MutableSharedFlow<RealtimeEvent>(replay = 0, extraBufferCapacity = 32)
    override val events: SharedFlow<RealtimeEvent> = _events.asSharedFlow()

    private val lifecycleMutex = Mutex()
    private var eventCollectorJob: Job? = null
    private var stateCollectorJob: Job? = null
    private var telemetryJob: Job? = null

    override suspend fun start() {
        lifecycleMutex.withLock {
            val credentials = sessionStorage.deviceCredentials()
            if (credentials == null) {
                _status.value = LinkStatus(LinkState.Disconnected, lastError = "Device is not enrolled")
                return
            }
            val session = sessionStorage.deviceSession()
            val needsFreshToken = session == null || session.expiresAtEpochMillis - System.currentTimeMillis() < FRESH_WINDOW_MILLIS
            if (needsFreshToken) {
                _status.value = LinkStatus(LinkState.Connecting)
                when (val result = deviceRegistration.obtainDeviceSession()) {
                    is com.droidlinkx.core.domain.model.Outcome.Failure -> {
                        _status.value = LinkStatus(
                            state = if (result.httpStatus == 401 || result.httpStatus == 403) LinkState.AuthorizationFailed else LinkState.Disconnected,
                            lastError = result.message,
                        )
                        return
                    }
                    is com.droidlinkx.core.domain.model.Outcome.Success -> Unit
                }
            }
            // No signalling relay deployed (SIGNALING_URL empty): the device is still fully
            // reachable through Supabase (PostgREST + realtime), so report a healthy cloud link
            // instead of retrying a WebSocket that does not exist.
            if (supabaseConfig.signalingUrl.isBlank()) {
                if (telemetryJob?.isActive != true) {
                    telemetryJob = scope.launch { telemetryLoop() }
                }
                _status.value = LinkStatus(LinkState.Authenticated)
                return
            }
            if (eventCollectorJob?.isActive != true) {
                eventCollectorJob = scope.launch { collectSocketEvents() }
            }
            if (stateCollectorJob?.isActive != true) {
                stateCollectorJob = scope.launch { collectSocketState() }
            }
            if (telemetryJob?.isActive != true) {
                telemetryJob = scope.launch { telemetryLoop() }
            }
            _status.value = LinkStatus(LinkState.Connecting)
            socket.connect()
        }
    }

    override suspend fun stop() {
        lifecycleMutex.withLock {
            eventCollectorJob?.cancel()
            stateCollectorJob?.cancel()
            telemetryJob?.cancel()
            eventCollectorJob = null
            stateCollectorJob = null
            telemetryJob = null
            socket.disconnect()
            _status.value = LinkStatus(LinkState.Disconnected)
        }
    }

    override fun send(event: Map<String, Any?>): Boolean = socket.send(event)

    private suspend fun collectSocketEvents() {
        socket.events.collect { socketEvent ->
            val json = socketEvent.json
            val type = json.optString("type")
            val parsed = parseEvent(type, json)
            if (parsed != null) _events.tryEmit(parsed)
            when (type) {
                "hello" -> _status.value = LinkStatus(LinkState.Authenticated)
                "device:online" -> recordEvent(json.optString("deviceId"), "Device came online")
                "device:offline" -> recordEvent(json.optString("deviceId"), "Device went offline")
                "error" -> DroidLog.w(message = "Realtime error: ${json.optString("message")}")
            }
            // Presence events for *this* device are mirrored into the local cache.
            val deviceId = json.optString("deviceId").takeIf { it.isNotBlank() }
            if (deviceId != null) {
                when (type) {
                    "device:online" -> deviceDao.setOnline(deviceId, true, isoNow())
                    "device:offline" -> deviceDao.setOnline(deviceId, false, isoNow())
                    "device:heartbeat" -> deviceDao.updateHeartbeat(
                        deviceId = deviceId,
                        battery = json.optInt("battery", -1).takeIf { it >= 0 },
                        charging = if (json.has("charging") && !json.isNull("charging")) json.optBoolean("charging") else null,
                        network = json.optString("network").takeIf { it.isNotBlank() },
                    )
                }
            }
        }
    }

    /**
     * The socket's own transport state drives the link status when it drops or is rejected.
     * It runs in its own coroutine because [collectSocketEvents] never completes.
     */
    private suspend fun collectSocketState() {
        socket.state.collect { state ->
            _status.value = when (state) {
                SocketState.Open -> LinkStatus(LinkState.Authenticated, sinceEpochMillis = System.currentTimeMillis())
                SocketState.Connecting -> LinkStatus(LinkState.Connecting)
                SocketState.Reconnecting -> LinkStatus(LinkState.Reconnecting, lastError = socket.lastError.value)
                SocketState.Rejected -> LinkStatus(LinkState.AuthorizationFailed, lastError = socket.lastError.value)
                SocketState.Closed, SocketState.Idle -> LinkStatus(LinkState.Disconnected)
            }
        }
    }

    private suspend fun telemetryLoop() {
        val intervalSeconds = settings.observeTelemetryIntervalSeconds().first()
        while (scope.isActive) {
            val credentials = sessionStorage.deviceCredentials()
            if (credentials != null && _status.value.state == LinkState.Authenticated) {
                val telemetry = telemetryRepository.collectNow()
                deviceCatalogue.reportTelemetry(telemetry)
                send(
                    mapOf(
                        "type" to "device:status",
                        "battery" to telemetry.battery,
                        "charging" to telemetry.charging,
                        "network" to telemetry.network,
                        "telemetry" to telemetry.toWireMap(),
                    ),
                )
                send(mapOf("type" to "device:heartbeat", "battery" to telemetry.battery))
            }
            delay(intervalSeconds.coerceIn(30L, 900L) * 1_000)
        }
    }

    private suspend fun recordEvent(deviceId: String, message: String) {
        if (deviceId.isBlank()) return
        connectionEventDao.insert(
            ConnectionEventEntity(
                deviceId = deviceId,
                deviceName = null,
                event = message,
                detail = null,
                createdAtEpochMillis = System.currentTimeMillis(),
            ),
        )
    }

    private fun parseEvent(type: String, json: JSONObject): RealtimeEvent? = runCatching {
        val raw = json.toString().let { text ->
            @Suppress("UNCHECKED_CAST")
            org.json.JSONObject(text).toMap()
        }
        when (type) {
            "device:online" -> RealtimeEvent.DeviceOnline(json.optString("deviceId"), raw)
            "device:offline" -> RealtimeEvent.DeviceOffline(json.optString("deviceId"), raw)
            "device:heartbeat" -> RealtimeEvent.DeviceHeartbeat(
                deviceId = json.optString("deviceId"),
                battery = json.optInt("battery", -1).takeIf { it >= 0 },
                charging = if (json.has("charging") && !json.isNull("charging")) json.optBoolean("charging") else null,
                network = json.optString("network").takeIf { it.isNotBlank() },
                raw = raw,
            )
            "connection:request" -> RealtimeEvent.ConnectionRequested(
                connectionId = json.optString("connectionId"),
                type = json.optString("connectionType"),
                fromId = json.optString("sourceDeviceId").takeIf { it.isNotBlank() },
                raw = raw,
            )
            "connection:accepted" -> RealtimeEvent.ConnectionAccepted(json.optString("connectionId"), raw)
            "connection:rejected" -> RealtimeEvent.ConnectionRejected(json.optString("connectionId"), json.optString("reason"), raw)
            "connection:ended" -> RealtimeEvent.ConnectionEnded(json.optString("connectionId"), json.optString("reason"), raw)
            "rtc:offer" -> RealtimeEvent.RtcOffer(json.optString("connectionId"), json.optString("sdp"), raw)
            "rtc:answer" -> RealtimeEvent.RtcAnswer(json.optString("connectionId"), json.optString("sdp"), raw)
            "rtc:ice" -> RealtimeEvent.RtcIce(
                connectionId = json.optString("connectionId"),
                candidate = json.optString("candidate"),
                sdpMid = json.optString("sdpMid").takeIf { it.isNotBlank() },
                sdpMLineIndex = json.optInt("sdpMLineIndex", -1).takeIf { it >= 0 },
                raw = raw,
            )
            "transfer:progress" -> RealtimeEvent.TransferProgress(
                transferId = json.optString("transferId"),
                bytes = json.optLong("bytes"),
                total = json.optLong("total", -1).takeIf { it >= 0 },
                raw = raw,
            )
            "hello" -> RealtimeEvent.ServerHello(
                role = json.optString("role").takeIf { it.isNotBlank() },
                heartbeatIntervalMs = json.optLong("heartbeatIntervalMs", -1).takeIf { it > 0 },
                raw = raw,
            )
            "error" -> RealtimeEvent.ServerError(json.optString("code"), json.optString("message"), raw)
            else -> RealtimeEvent.Unknown(type, raw)
        }
    }.getOrNull()

    private fun isoNow(): String = java.time.Instant.now().toString()

    companion object {
        private const val FRESH_WINDOW_MILLIS = 60_000L
    }
}

private fun JSONObject.toMap(): Map<String, Any?> {
    val result = mutableMapOf<String, Any?>()
    keys().forEach { key ->
        result[key] = when (val value = get(key)) {
            is JSONObject -> value.toMap()
            JSONObject.NULL -> null
            else -> value
        }
    }
    return result
}
