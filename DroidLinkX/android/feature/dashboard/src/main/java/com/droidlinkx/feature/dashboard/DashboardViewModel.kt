package com.droidlinkx.feature.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.droidlinkx.core.domain.model.Device
import com.droidlinkx.core.domain.model.DeviceTelemetry
import com.droidlinkx.core.domain.model.EnrolledDevice
import com.droidlinkx.core.domain.model.InitializationState
import com.droidlinkx.core.domain.model.LinkState
import com.droidlinkx.core.domain.model.LinkStatus
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.OwnerSession
import com.droidlinkx.core.domain.repository.DeviceCatalogueRepository
import com.droidlinkx.core.domain.repository.DeviceRegistrationRepository
import com.droidlinkx.core.domain.repository.LinkManager
import com.droidlinkx.core.domain.repository.OwnerAuthRepository
import com.droidlinkx.core.domain.repository.StartupCoordinator
import com.droidlinkx.core.domain.repository.TelemetryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DashboardUiState(
    val devices: List<Device> = emptyList(),
    val localDevice: EnrolledDevice? = null,
    val telemetry: DeviceTelemetry = DeviceTelemetry(),
    val link: LinkStatus = LinkStatus(),
    val initialization: InitializationState = InitializationState(),
    val owner: OwnerSession? = null,
    val refreshing: Boolean = false,
    val error: String? = null,
) {
    val onlineCount: Int get() = devices.count { it.online }
    val isLinkHealthy: Boolean get() = link.state == LinkState.Authenticated
}

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val deviceCatalogue: DeviceCatalogueRepository,
    deviceRegistration: DeviceRegistrationRepository,
    telemetryRepository: TelemetryRepository,
    private val linkManager: LinkManager,
    startupCoordinator: StartupCoordinator,
    ownerAuthRepository: OwnerAuthRepository,
) : ViewModel() {

    private val refreshing = MutableStateFlow(false)
    private val error = MutableStateFlow<String?>(null)

    private val localBundle = combine(
        deviceRegistration.observeEnrolledDevice(),
        telemetryRepository.observe(),
        ownerAuthRepository.observeSession(),
    ) { enrolled, telemetry, owner -> Triple(enrolled, telemetry, owner) }

    val state: StateFlow<DashboardUiState> = combine(
        deviceCatalogue.observeDevices(),
        linkManager.status,
        startupCoordinator.state,
        localBundle,
        refreshing,
    ) { devices, link, initialization, bundle, isRefreshing ->
        DashboardUiState(
            devices = devices,
            localDevice = bundle.first,
            telemetry = bundle.second,
            owner = bundle.third,
            link = link,
            initialization = initialization,
            refreshing = isRefreshing,
        )
    }
        .combine(error) { base, currentError -> base.copy(error = currentError) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DashboardUiState())

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            refreshing.value = true
            when (val result = deviceCatalogue.refresh()) {
                is Outcome.Failure -> error.value = result.message
                is Outcome.Success -> error.value = null
            }
            refreshing.value = false
        }
    }

    fun reconnect() {
        viewModelScope.launch {
            linkManager.stop()
            linkManager.start()
        }
    }
}
