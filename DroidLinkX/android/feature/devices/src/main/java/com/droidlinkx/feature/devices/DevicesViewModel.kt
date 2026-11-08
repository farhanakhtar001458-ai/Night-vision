package com.droidlinkx.feature.devices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.droidlinkx.core.domain.model.Device
import com.droidlinkx.core.domain.model.EnrolledDevice
import com.droidlinkx.core.domain.model.LinkStatus
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.repository.ConnectionRepository
import com.droidlinkx.core.domain.repository.DeviceCatalogueRepository
import com.droidlinkx.core.domain.repository.DeviceRegistrationRepository
import com.droidlinkx.core.domain.repository.LinkManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DevicesUiState(
    val devices: List<Device> = emptyList(),
    val localDevice: EnrolledDevice? = null,
    val link: LinkStatus = LinkStatus(),
    val busy: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

@HiltViewModel
class DevicesViewModel @Inject constructor(
    private val deviceCatalogue: DeviceCatalogueRepository,
    deviceRegistration: DeviceRegistrationRepository,
    linkManager: LinkManager,
    private val connectionRepository: ConnectionRepository,
) : ViewModel() {

    private val busy = MutableStateFlow(false)
    private val message = MutableStateFlow<String?>(null)
    private val error = MutableStateFlow<String?>(null)

    val state: StateFlow<DevicesUiState> = combine(
        deviceCatalogue.observeDevices(),
        deviceRegistration.observeEnrolledDevice(),
        linkManager.status,
        busy,
        message,
    ) { devices, local, link, isBusy, info ->
        DevicesUiState(devices = devices, localDevice = local, link = link, busy = isBusy, message = info)
    }
        .combine(error) { base, err -> base.copy(error = err) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), DevicesUiState())

    init {
        refresh()
        // Presence changes on the other devices' side; refresh while this screen is open so the
        // online dot is not a snapshot from when the tab was first opened.
        viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(20_000)
                deviceCatalogue.refresh()
            }
        }
    }

    fun refresh() {
        viewModelScope.launch { handle(deviceCatalogue.refresh()) { } }
    }

    fun rename(deviceId: String, name: String) {
        if (name.isBlank()) return
        viewModelScope.launch { handle(deviceCatalogue.rename(deviceId, name)) { message.value = "Device renamed" } }
    }

    fun setTrusted(deviceId: String, trusted: Boolean) {
        viewModelScope.launch {
            handle(deviceCatalogue.setTrusted(deviceId, trusted)) {
                message.value = if (trusted) "Device marked as trusted" else "Device no longer trusted"
            }
        }
    }

    fun setPermission(deviceId: String, permission: String, granted: Boolean) {
        viewModelScope.launch {
            handle(deviceCatalogue.setPermission(deviceId, permission, granted)) {
                message.value = "$permission ${if (granted) "enabled" else "disabled"}"
            }
        }
    }

    fun revoke(deviceId: String) {
        viewModelScope.launch { handle(deviceCatalogue.revoke(deviceId)) { message.value = "Device revoked" } }
    }

    /** Asks the owner-authorized backend for a mirroring session with the selected device. */
    fun requestMirroring(deviceId: String) {
        viewModelScope.launch {
            busy.value = true
            when (val result = connectionRepository.requestSession(deviceId, "mirror")) {
                is Outcome.Success -> message.value = "Session ${result.value.connectionId.take(8)} requested — accept it on the device"
                is Outcome.Failure -> error.value = result.message
            }
            busy.value = false
        }
    }

    fun dismissMessage() {
        message.value = null
        error.value = null
    }

    private fun handle(result: Outcome<*>, onSuccess: () -> Unit) {
        when (result) {
            is Outcome.Success -> {
                error.value = null
                onSuccess()
            }
            is Outcome.Failure -> error.value = result.message
        }
    }
}
