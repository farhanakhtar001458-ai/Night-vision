package com.droidlinkx.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.droidlinkx.core.domain.model.EnrolledDevice
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.OwnerSession
import com.droidlinkx.core.domain.repository.DeviceRegistrationRepository
import com.droidlinkx.core.domain.repository.DeviceSettingsRepository
import com.droidlinkx.core.domain.repository.LinkServiceController
import com.droidlinkx.core.domain.repository.OwnerAuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val apiBaseUrl: String = "",
    val telemetryIntervalSeconds: Long = 60,
    val keepAliveEnabled: Boolean = true,
    val device: EnrolledDevice? = null,
    val owner: OwnerSession? = null,
    val message: String? = null,
    val error: String? = null,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settings: DeviceSettingsRepository,
    private val deviceRegistration: DeviceRegistrationRepository,
    private val ownerAuth: OwnerAuthRepository,
    private val linkService: LinkServiceController,
) : ViewModel() {

    private val message = MutableStateFlow<String?>(null)
    private val error = MutableStateFlow<String?>(null)

    val state: StateFlow<SettingsUiState> = combine(
        settings.observeApiBaseUrl(),
        settings.observeTelemetryIntervalSeconds(),
        settings.observeKeepAliveEnabled(),
        deviceRegistration.observeEnrolledDevice(),
        ownerAuth.observeSession(),
    ) { url, interval, keepAlive, device, owner ->
        SettingsUiState(
            apiBaseUrl = url,
            telemetryIntervalSeconds = interval,
            keepAliveEnabled = keepAlive,
            device = device,
            owner = owner,
        )
    }
        .combine(message) { base, info -> base.copy(message = info) }
        .combine(error) { base, err -> base.copy(error = err) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsUiState())

    fun saveServerUrl(url: String) {
        viewModelScope.launch {
            when (val result = settings.setApiBaseUrl(url)) {
                is Outcome.Success -> message.value = "Server URL saved. Reconnecting…"
                is Outcome.Failure -> error.value = result.message
            }
        }
    }

    fun setTelemetryInterval(seconds: Long) {
        viewModelScope.launch {
            settings.setTelemetryIntervalSeconds(seconds)
            message.value = "Telemetry interval set to ${seconds}s"
        }
    }

    fun setKeepAlive(enabled: Boolean) {
        viewModelScope.launch {
            settings.setKeepAliveEnabled(enabled)
            if (enabled) linkService.start() else linkService.stop()
            message.value = if (enabled) "Foreground connection enabled" else "Foreground connection disabled"
        }
    }

    fun forgetDevice() {
        viewModelScope.launch {
            deviceRegistration.forgetDevice()
            message.value = "This device was removed from the account"
        }
    }

    fun logout() {
        viewModelScope.launch { ownerAuth.logout() }
    }

    fun dismiss() {
        message.value = null
        error.value = null
    }
}
