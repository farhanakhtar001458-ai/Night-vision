package com.droidlinkx.core.data.repository

import com.droidlinkx.core.database.dao.DeviceDao
import com.droidlinkx.core.database.entity.CachedDeviceEntity
import com.droidlinkx.core.domain.model.Device
import com.droidlinkx.core.domain.model.DeviceTelemetry
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.map
import com.droidlinkx.core.domain.model.toFailure
import com.droidlinkx.core.domain.repository.DeviceCatalogueRepository
import com.droidlinkx.core.domain.repository.OwnerAuthRepository
import com.droidlinkx.core.network.api.DeviceApi
import com.droidlinkx.core.network.api.OwnerApi
import com.droidlinkx.core.network.dto.DeviceDto
import com.droidlinkx.core.network.dto.DeviceStatusRequestDto
import com.droidlinkx.core.network.dto.PermissionRequestDto
import com.droidlinkx.core.network.dto.UpdateDeviceRequestDto
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DeviceCatalogueRepositoryImpl @Inject constructor(
    private val ownerApi: OwnerApi,
    private val deviceApi: DeviceApi,
    private val ownerAuthRepository: OwnerAuthRepository,
    private val sessionStorage: SessionStorage,
    private val deviceDao: DeviceDao,
) : DeviceCatalogueRepository {

    override fun observeDevices(): Flow<List<Device>> = deviceDao.observeAll().map { rows ->
        rows.map { it.toDomain() }
    }

    override suspend fun refresh(): Outcome<List<Device>> =
        ownerAuthRepository.authorized { ownerApi.devices() }.let { result ->
            when (result) {
                is Outcome.Failure -> result
                is Outcome.Success -> {
                    val mapped = result.value.devices.map { it.toDomain() }
                    deviceDao.upsert(mapped.map { it.toEntity() })
                    Outcome.Success(mapped)
                }
            }
        }

    override suspend fun rename(deviceId: String, name: String): Outcome<Unit> =
        mutate(deviceId) { ownerApi.updateDevice(deviceId, UpdateDeviceRequestDto(name = name.trim())) }

    override suspend fun setTrusted(deviceId: String, trusted: Boolean): Outcome<Unit> =
        mutate(deviceId) { ownerApi.updateDevice(deviceId, UpdateDeviceRequestDto(trusted = trusted)) }

    override suspend fun revoke(deviceId: String): Outcome<Unit> =
        ownerAuthRepository.authorized { ownerApi.revokeDevice(deviceId) }.let { result ->
            when (result) {
                is Outcome.Failure -> result
                is Outcome.Success -> {
                    deviceDao.delete(deviceId)
                    Outcome.Success(Unit)
                }
            }
        }

    override suspend fun setPermission(deviceId: String, permission: String, granted: Boolean): Outcome<Unit> =
        ownerAuthRepository.authorized {
            ownerApi.updatePermission(deviceId, permission, PermissionRequestDto(granted))
        }.map { }

    override suspend fun reportTelemetry(telemetry: DeviceTelemetry): Outcome<Unit> {
        val credentials = sessionStorage.deviceCredentials()
            ?: return Outcome.Failure("Device is not enrolled", code = "NOT_ENROLLED")
        return try {
            deviceApi.reportStatus(
                credentials.deviceId,
                DeviceStatusRequestDto(telemetry = telemetry.toWireMap()),
            )
            Outcome.Success(Unit)
        } catch (http: HttpException) {
            Outcome.Failure(
                message = "Telemetry rejected (HTTP ${http.code()})",
                code = "HTTP_${http.code()}",
                httpStatus = http.code(),
                cause = http,
            )
        } catch (io: IOException) {
            Outcome.Failure("Telemetry could not be delivered", code = "NETWORK", cause = io)
        } catch (t: Throwable) {
            t.toFailure("Telemetry failed")
        }
    }

    private suspend fun mutate(
        deviceId: String,
        call: suspend () -> com.droidlinkx.core.network.dto.DeviceEnvelopeDto,
    ): Outcome<Unit> = ownerAuthRepository.authorized(call).let { result ->
        when (result) {
            is Outcome.Failure -> result
            is Outcome.Success -> {
                deviceDao.upsert(listOf(result.value.device.toDomain().toEntity()))
                Outcome.Success(Unit)
            }
        }
    }
}

/* ------------------------------ mapping ------------------------------ */

private fun isRecentlySeen(lastSeenAt: String?): Boolean {
    if (lastSeenAt.isNullOrBlank()) return false
    return runCatching {
        java.time.Instant.parse(lastSeenAt).isAfter(java.time.Instant.now().minusSeconds(300))
    }.getOrDefault(true)
}

internal fun DeviceDto.toDomain(): Device = Device(
    id = id,
    name = name,
    manufacturer = manufacturer,
    model = model,
    androidVersion = androidVersion,
    sdkInt = sdkInt,
    appVersion = appVersion,
    online = online && isRecentlySeen(lastSeenAt),
    trusted = trusted,
    connectionQuality = connectionQuality ?: if (online) "unknown" else "offline",
    lastSeenAt = lastSeenAt,
    telemetry = telemetry.toTelemetry(),
    permissions = permissions,
)

private fun Map<String, Any?>.toTelemetry(): DeviceTelemetry = DeviceTelemetry(
    battery = this["battery"].asInt(),
    charging = this["charging"] as? Boolean,
    network = this["network"] as? String,
    ip = this["ip"] as? String,
    storageFreeBytes = this["storageFreeBytes"].asLong(),
    storageTotalBytes = this["storageTotalBytes"].asLong(),
    ramUsedBytes = this["ramUsedBytes"].asLong(),
    ramTotalBytes = this["ramTotalBytes"].asLong(),
    cpu = this["cpu"] as? String,
    screenResolution = this["screenResolution"] as? String,
    uptimeSeconds = this["uptimeSeconds"].asLong(),
    batteryTemperatureC = (this["batteryTemperatureC"] as? Number)?.toDouble(),
    latencyMs = this["latencyMs"].asLong(),
)

private fun Any?.asInt(): Int? = (this as? Number)?.toInt()
private fun Any?.asLong(): Long? = (this as? Number)?.toLong()

internal fun Device.toEntity(): CachedDeviceEntity = CachedDeviceEntity(
    id = id,
    name = name,
    manufacturer = manufacturer,
    model = model,
    androidVersion = androidVersion,
    sdkInt = sdkInt,
    appVersion = appVersion,
    online = online,
    trusted = trusted,
    connectionQuality = connectionQuality,
    lastSeenAt = lastSeenAt,
    battery = telemetry.battery,
    charging = telemetry.charging,
    network = telemetry.network,
    storageFreeBytes = telemetry.storageFreeBytes,
    storageTotalBytes = telemetry.storageTotalBytes,
    ramUsedBytes = telemetry.ramUsedBytes,
    ramTotalBytes = telemetry.ramTotalBytes,
    updatedAtEpochMillis = System.currentTimeMillis(),
)

internal fun CachedDeviceEntity.toDomain(): Device = Device(
    id = id,
    name = name,
    manufacturer = manufacturer,
    model = model,
    androidVersion = androidVersion,
    sdkInt = sdkInt,
    appVersion = appVersion,
    // The cached flag can be days old; presence is only meaningful with a fresh heartbeat.
    online = online && isRecentlySeen(lastSeenAt),
    trusted = trusted,
    connectionQuality = connectionQuality,
    lastSeenAt = lastSeenAt,
    telemetry = DeviceTelemetry(
        battery = battery,
        charging = charging,
        network = network,
        storageFreeBytes = storageFreeBytes,
        storageTotalBytes = storageTotalBytes,
        ramUsedBytes = ramUsedBytes,
        ramTotalBytes = ramTotalBytes,
    ),
    permissions = emptyMap(),
)
