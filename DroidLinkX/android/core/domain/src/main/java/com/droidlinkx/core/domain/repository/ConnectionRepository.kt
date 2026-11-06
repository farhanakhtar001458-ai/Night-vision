package com.droidlinkx.core.domain.repository

import com.droidlinkx.core.domain.model.Outcome

data class SessionRequest(
    val connectionId: String,
    val type: String,
    val sourceDeviceId: String,
    val status: String,
)

interface ConnectionRepository {
    /** Creates an authenticated signalling session and notifies the device over WebSocket. */
    suspend fun requestSession(sourceDeviceId: String, type: String, targetDeviceId: String? = null): Outcome<SessionRequest>
    suspend fun terminate(connectionId: String, reason: String): Outcome<Unit>
}

/** Controls the foreground service that keeps the authenticated link alive. */
interface LinkServiceController {
    fun start()
    fun stop()
}
