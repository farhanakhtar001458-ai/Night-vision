package com.droidlinkx.core.domain.repository

import com.droidlinkx.core.domain.model.Device
import com.droidlinkx.core.domain.model.DeviceTelemetry
import com.droidlinkx.core.domain.model.EnrolledDevice
import com.droidlinkx.core.domain.model.InitializationState
import com.droidlinkx.core.domain.model.LinkStatus
import com.droidlinkx.core.domain.model.OwnerSession
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.RealtimeEvent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow

interface OwnerAuthRepository {
    fun observeSession(): Flow<OwnerSession?>
    suspend fun register(email: String, password: String, displayName: String): Outcome<OwnerSession>
    suspend fun login(email: String, password: String): Outcome<OwnerSession>
    suspend fun restoreSession(): Outcome<OwnerSession?>
    suspend fun refreshSession(): Outcome<OwnerSession>
    /** Runs an owner-scoped API call, refreshing the access token once if the server answers 401. */
    suspend fun <T> authorized(block: suspend () -> T): Outcome<T>
    suspend fun logout()
}

interface DeviceRegistrationRepository {
    fun observeEnrolledDevice(): Flow<EnrolledDevice?>
    /** Completes the automatic registration sequence: identity -> credential -> cloud enrollment. */
    suspend fun registerCurrentDevice(): Outcome<EnrolledDevice>
    /** Exchanges the stored device secret for a device bearer token bound to a revocable session. */
    suspend fun obtainDeviceSession(): Outcome<Unit>
    fun deviceAccessToken(): String?
    val deviceSessionId: String?
    suspend fun forgetDevice()
}

interface DeviceCatalogueRepository {
    fun observeDevices(): Flow<List<Device>>
    suspend fun refresh(): Outcome<List<Device>>
    suspend fun rename(deviceId: String, name: String): Outcome<Unit>
    suspend fun setTrusted(deviceId: String, trusted: Boolean): Outcome<Unit>
    suspend fun revoke(deviceId: String): Outcome<Unit>
    suspend fun setPermission(deviceId: String, permission: String, granted: Boolean): Outcome<Unit>
    suspend fun reportTelemetry(telemetry: DeviceTelemetry): Outcome<Unit>
}

interface LinkManager {
    val status: Flow<LinkStatus>
    val events: SharedFlow<RealtimeEvent>
    suspend fun start()
    suspend fun stop()
    fun send(event: Map<String, Any?>): Boolean
}

interface TelemetryRepository {
    fun observe(): Flow<DeviceTelemetry>
    suspend fun collectNow(): DeviceTelemetry
}

interface StartupCoordinator {
    val state: Flow<InitializationState>
    suspend fun initialize(): InitializationState
}

interface DeviceSettingsRepository {
    fun observeApiBaseUrl(): Flow<String>
    suspend fun setApiBaseUrl(url: String): Outcome<Unit>
    fun observeTelemetryIntervalSeconds(): Flow<Long>
    suspend fun setTelemetryIntervalSeconds(seconds: Long)
    fun observeKeepAliveEnabled(): Flow<Boolean>
    suspend fun setKeepAliveEnabled(enabled: Boolean)
}
