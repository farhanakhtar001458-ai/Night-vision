package com.droidlinkx.core.data.repository

import android.os.Build
import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.data.BuildConfig
import com.droidlinkx.core.domain.model.EnrolledDevice
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.toFailure
import com.droidlinkx.core.domain.repository.DeviceRegistrationRepository
import com.droidlinkx.core.domain.repository.OwnerAuthRepository
import com.droidlinkx.core.network.api.PublicApi
import com.droidlinkx.core.network.dto.DeviceTokenRequestDto
import com.droidlinkx.core.network.dto.EnrollRequestDto
import com.droidlinkx.core.network.supabase.SupabaseDeviceRow
import com.droidlinkx.core.network.supabase.SupabaseRestApi
import java.time.Instant
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DeviceRegistrationRepositoryImpl @Inject constructor(
    private val publicApi: PublicApi,
    private val ownerAuthRepository: OwnerAuthRepository,
    private val ownerApiProvider: javax.inject.Provider<com.droidlinkx.core.network.api.OwnerApi>,
    private val sessionStorage: SessionStorage,
    private val rest: SupabaseRestApi,
) : DeviceRegistrationRepository {

    private val enrolledState = MutableStateFlow(sessionStorage.deviceCredentials()?.toEnrolledDevice())
    private val mutex = Mutex()

    override fun observeEnrolledDevice(): Flow<EnrolledDevice?> = enrolledState.asStateFlow()

    override suspend fun registerCurrentDevice(): Outcome<EnrolledDevice> = mutex.withLock {
        sessionStorage.deviceCredentials()?.let { existing ->
            enrolledState.value = existing.toEnrolledDevice()
            markOnline(existing.deviceId)
            return@withLock Outcome.Success(existing.toEnrolledDevice())
        }
        if (sessionStorage.ownerSession() == null) {
            return@withLock Outcome.Failure("Sign in with the owner account before enrolling this device", code = "NO_OWNER")
        }
        val identity = sessionStorage.installationId()
        DroidLog.i(message = "Registering device $identity with the owner account")

        // Reinstalling the app wipes the Keystore, so local credentials are gone while the server
        // row still exists. Adopt that row instead of enrolling a duplicate for the same phone.
        val knownDevices = runCatching { rest.devices() }.getOrNull().orEmpty()
        val existingRow = knownDevices.adoptableRow()
        if (existingRow != null) {
            val adopted = SessionStorage.DeviceCredentials(
                deviceId = existingRow.id,
                secret = "",
                name = existingRow.name,
                wsUrl = "",
                enrolledAtEpochMillis = System.currentTimeMillis(),
            )
            sessionStorage.saveDeviceCredentials(adopted)
            enrolledState.value = adopted.toEnrolledDevice()
            markOnline(existingRow.id)
            dropStaleDuplicates(knownDevices, existingRow)
            DroidLog.i(message = "Adopted existing device row ${existingRow.id}")
            return@withLock Outcome.Success(adopted.toEnrolledDevice())
        }

        val result = ownerAuthRepository.authorized {
            ownerApiProvider.get().enrollDevice(
                EnrollRequestDto(
                    name = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android device",
                    manufacturer = Build.MANUFACTURER?.replaceFirstChar { it.uppercase() },
                    model = Build.MODEL,
                    androidVersion = Build.VERSION.RELEASE,
                    sdkInt = Build.VERSION.SDK_INT,
                    appVersion = BuildConfig.DEVICE_AGENT_VERSION,
                    platform = "android",
                ),
            )
        }

        when (result) {
            is Outcome.Failure -> result
            is Outcome.Success -> {
                val response = result.value
                val credentials = SessionStorage.DeviceCredentials(
                    deviceId = response.deviceId,
                    secret = response.deviceSecret,
                    name = response.device.name,
                    wsUrl = response.wsUrl,
                    enrolledAtEpochMillis = System.currentTimeMillis(),
                )
                sessionStorage.saveDeviceCredentials(credentials)
                enrolledState.value = credentials.toEnrolledDevice()
                DroidLog.i(message = "Device enrolled as ${response.deviceId}")
                markOnline(response.deviceId)
                when (val session = obtainDeviceSession()) {
                    is Outcome.Failure -> Outcome.Success(credentials.toEnrolledDevice())
                    is Outcome.Success -> Outcome.Success(credentials.toEnrolledDevice())
                }
            }
        }
    }

    override suspend fun obtainDeviceSession(): Outcome<Unit> {
        val credentials = sessionStorage.deviceCredentials()
            ?: return Outcome.Failure("This device is not enrolled yet", code = "NOT_ENROLLED")
        // Without a device secret there is nothing to exchange: this install talks to Supabase with
        // the owner token, so a device session is simply not required.
        if (credentials.secret.isBlank()) return Outcome.Success(Unit)
        return try {
            val response = publicApi.exchangeDeviceSecret(
                DeviceTokenRequestDto(deviceId = credentials.deviceId, deviceSecret = credentials.secret),
            )
            sessionStorage.saveDeviceSession(
                SessionStorage.DeviceSession(
                    accessToken = response.accessToken,
                    sessionId = response.sessionId,
                    expiresAtEpochMillis = System.currentTimeMillis() + response.expiresIn * 1_000,
                ),
            )
            if (response.wsUrl.isNotBlank()) {
                sessionStorage.saveDeviceCredentials(credentials.copy(wsUrl = response.wsUrl))
            }
            Outcome.Success(Unit)
        } catch (http: HttpException) {
            val message = when (http.code()) {
                401 -> "Device credential rejected by the server. Re-enroll this device."
                403 -> "This device has been revoked by the owner."
                else -> "Device authentication failed (HTTP ${http.code()})."
            }
            Outcome.Failure(message, code = "DEVICE_AUTH", httpStatus = http.code(), cause = http)
        } catch (io: IOException) {
            Outcome.Failure(
                message = "Cannot reach the cloud backend to authenticate this device.",
                code = "NETWORK",
                cause = io,
            )
        } catch (t: Throwable) {
            t.toFailure("Device authentication failed")
        }
    }

    override fun deviceAccessToken(): String? = sessionStorage.deviceSession()?.accessToken

    /** This phone's own row, matching the hardware it runs on. */
    private fun List<SupabaseDeviceRow>.adoptableRow(): SupabaseDeviceRow? {
        val model = Build.MODEL?.trim().orEmpty()
        val manufacturer = Build.MANUFACTURER?.trim().orEmpty()
        if (model.isBlank()) return null
        return filter { row ->
            row.status == "active" &&
                row.model?.trim().equals(model, ignoreCase = true) &&
                (manufacturer.isBlank() || row.manufacturer?.trim().equals(manufacturer, ignoreCase = true))
        }.maxByOrNull { it.createdAt }
    }

    /**
     * Rows for the same hardware that were never seen online are leftovers from repeated enrolments
     * of this same phone; a genuinely second device of the same model reports telemetry and is kept.
     */
    private suspend fun dropStaleDuplicates(rows: List<SupabaseDeviceRow>, keep: SupabaseDeviceRow) {
        rows.asSequence()
            .filter { it.id != keep.id }
            .filter { it.model?.trim().equals(keep.model?.trim(), ignoreCase = true) }
            .filter { it.lastSeenAt == null && it.telemetry.isEmpty() }
            .forEach { stale -> runCatching { rest.deleteDevice(stale.id) } }
    }

    private suspend fun markOnline(deviceId: String) {
        if (deviceId.isBlank()) return
        runCatching {
            rest.patchDevice(
                deviceId,
                mapOf("online" to true, "last_seen_at" to Instant.now().toString()),
            )
        }
    }

    override val deviceSessionId: String? get() = sessionStorage.deviceSession()?.sessionId

    override suspend fun forgetDevice() {
        val credentials = sessionStorage.deviceCredentials()
        if (credentials != null) {
            runCatching {
                ownerAuthRepository.authorized { ownerApiProvider.get().revokeDevice(credentials.deviceId) }
            }
        }
        sessionStorage.forgetDevice()
        enrolledState.value = null
    }

    private fun SessionStorage.DeviceCredentials.toEnrolledDevice() = EnrolledDevice(
        deviceId = deviceId,
        secret = secret,
        name = name,
        wsUrl = wsUrl,
        enrolledAtEpochMillis = enrolledAtEpochMillis,
    )
}
