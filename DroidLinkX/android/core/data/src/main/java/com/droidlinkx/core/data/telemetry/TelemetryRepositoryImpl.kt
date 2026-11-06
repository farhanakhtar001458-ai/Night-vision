package com.droidlinkx.core.data.telemetry

import com.droidlinkx.core.domain.model.DeviceTelemetry
import com.droidlinkx.core.domain.repository.TelemetryRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TelemetryRepositoryImpl @Inject constructor(
    private val collector: DeviceTelemetryCollector,
) : TelemetryRepository {

    private val state = MutableStateFlow(collector.collect())

    override fun observe(): Flow<DeviceTelemetry> = state.asStateFlow()

    override suspend fun collectNow(): DeviceTelemetry {
        val snapshot = collector.collect()
        state.value = snapshot
        return snapshot
    }
}
