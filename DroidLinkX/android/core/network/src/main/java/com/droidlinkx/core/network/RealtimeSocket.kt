package com.droidlinkx.core.network

import com.droidlinkx.core.common.DroidLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import kotlin.math.min
import kotlin.math.pow
import kotlin.random.Random

enum class SocketState { Idle, Connecting, Open, Closed, Reconnecting, Rejected }

data class SocketEvent(val json: JSONObject)

/**
 * Authenticated WebSocket transport with jittered exponential backoff, a heartbeat and a hard cap on
 * reconnect attempts per backoff cycle. It intentionally never spins: every retry is delayed and paced.
 */
class RealtimeSocket(
    private val client: OkHttpClient,
    private val scope: CoroutineScope,
    private val urlProvider: () -> String?,
    private val heartbeatIntervalMillis: Long = 25_000,
    private val maxBackoffMillis: Long = 60_000,
) {
    private var webSocket: WebSocket? = null
    private var heartbeatJob: Job? = null
    private var reconnectJob: Job? = null
    private var attempt = 0
    private var intentionalClose = false

    private val _events = MutableSharedFlow<SocketEvent>(
        replay = 0,
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val events: SharedFlow<SocketEvent> = _events.asSharedFlow()

    private val _state = MutableStateFlow(SocketState.Idle)
    val state: StateFlow<SocketState> = _state.asStateFlow()

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError.asStateFlow()

    fun connect() {
        val url = urlProvider()
        if (url.isNullOrBlank()) {
            _lastError.value = "No authenticated session available yet"
            _state.value = SocketState.Idle
            return
        }
        intentionalClose = false
        reconnectJob?.cancel()
        closeCurrent()
        _state.value = if (attempt == 0) SocketState.Connecting else SocketState.Reconnecting
        val request = Request.Builder().url(url).build()
        webSocket = client.newWebSocket(request, listener)
    }

    fun disconnect() {
        intentionalClose = true
        reconnectJob?.cancel()
        stopHeartbeat()
        closeCurrent()
        attempt = 0
        _state.value = SocketState.Idle
    }

    fun send(payload: Map<String, Any?>): Boolean {
        val socket = webSocket ?: return false
        val json = JSONObject(payload).toString()
        return socket.send(json)
    }

    private fun closeCurrent() {
        stopHeartbeat()
        webSocket?.close(1000, "client closing")
        webSocket = null
    }

    private fun startHeartbeat() {
        stopHeartbeat()
        heartbeatJob = scope.launch {
            while (isActive) {
                delay(heartbeatIntervalMillis)
                send(mapOf("type" to "ping", "t" to System.currentTimeMillis()))
            }
        }
    }

    private fun stopHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob = null
    }

    private fun scheduleReconnect(reason: String) {
        if (intentionalClose || !scope.isActive) return
        attempt += 1
        val backoff = min(maxBackoffMillis, (1_000 * 1.9.pow(min(attempt, 8))).toLong())
        val delayMillis = (backoff * (0.75 + Random.nextDouble() * 0.5)).toLong()
        _lastError.value = reason
        _state.value = SocketState.Reconnecting
        DroidLog.w(message = "WebSocket reconnecting in ${delayMillis}ms (attempt $attempt): $reason")
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(delayMillis)
            connect()
        }
    }

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            attempt = 0
            _state.value = SocketState.Open
            _lastError.value = null
            startHeartbeat()
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val json = runCatching { JSONObject(text) }.getOrNull() ?: return
            _events.tryEmit(SocketEvent(json))
            if (json.optString("type") == "hello") {
                attempt = 0
                _state.value = SocketState.Open
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            stopHeartbeat()
            if (intentionalClose) {
                _state.value = SocketState.Idle
                return
            }
            if (code == 4401 || code == 4403) {
                _state.value = SocketState.Rejected
                _lastError.value = reason.ifBlank { "Session rejected by the server" }
                return
            }
            scheduleReconnect("socket closed ($code) $reason")
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            stopHeartbeat()
            if (intentionalClose) {
                _state.value = SocketState.Idle
                return
            }
            val status = response?.code
            if (status == 401) {
                _state.value = SocketState.Rejected
                _lastError.value = "Authentication rejected by the server"
                return
            }
            scheduleReconnect(t.message ?: "network failure")
        }
    }
}
