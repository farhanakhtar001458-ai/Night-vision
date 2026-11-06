package com.droidlinkx.feature.tools

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.droidlinkx.core.data.mirroring.ScreenMirroringController
import com.droidlinkx.core.data.mirroring.ScreenShareService
import com.droidlinkx.core.data.notification.NotificationRelayService
import com.droidlinkx.core.data.notification.NotificationShareStore
import com.droidlinkx.core.data.repository.SessionStorage
import com.droidlinkx.core.domain.model.MirroringState
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.SharedNotification
import com.droidlinkx.core.domain.repository.NotificationShareRepository
import com.droidlinkx.core.network.supabase.SupabaseRestApi
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.webrtc.SurfaceViewRenderer
import javax.inject.Inject

data class RemoteDevice(
    val id: String,
    val name: String,
    val online: Boolean,
    val isThisDevice: Boolean,
)

data class ToolsUiState(
    val sharingEnabled: Boolean = false,
    val relayEnabled: Boolean = false,
    val notificationAccess: Boolean = false,
    val devices: List<RemoteDevice> = emptyList(),
    val recent: List<SharedNotification> = emptyList(),
    val mirroring: MirroringState = MirroringState(),
    val busy: Boolean = false,
    val message: String? = null,
    val error: String? = null,
)

@HiltViewModel
class ToolsViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val mirroring: ScreenMirroringController,
    private val notifications: NotificationShareRepository,
    private val store: NotificationShareStore,
    private val rest: SupabaseRestApi,
    private val sessionStorage: SessionStorage,
) : ViewModel() {

    private val devices = MutableStateFlow<List<RemoteDevice>>(emptyList())
    private val recent = MutableStateFlow<List<SharedNotification>>(emptyList())
    private val notificationAccess = MutableStateFlow(hasNotificationAccess())
    private val busy = MutableStateFlow(false)
    private val message = MutableStateFlow<String?>(null)
    private val error = MutableStateFlow<String?>(null)

    val state: StateFlow<ToolsUiState> = combine(
        store.sharing,
        store.relay,
        notificationAccess,
        devices,
        recent,
        mirroring.state,
        busy,
        message,
        error,
    ) { values ->
        @Suppress("UNCHECKED_CAST")
        ToolsUiState(
            sharingEnabled = values[0] as Boolean,
            relayEnabled = values[1] as Boolean,
            notificationAccess = values[2] as Boolean,
            devices = values[3] as List<RemoteDevice>,
            recent = values[4] as List<SharedNotification>,
            mirroring = values[5] as MirroringState,
            busy = values[6] as Boolean,
            message = values[7] as String?,
            error = values[8] as String?,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ToolsUiState())

    init {
        refreshDevices()
        refreshRecent()
    }

    fun refreshDevices() {
        viewModelScope.launch {
            busy.value = true
            val myId = sessionStorage.deviceCredentials()?.deviceId
            val result = runCatching { rest.devices() }
            result.onSuccess { rows ->
                devices.value = rows.map { row ->
                    RemoteDevice(
                        id = row.id,
                        name = row.name,
                        online = row.online,
                        isThisDevice = row.id == myId,
                    )
                }
            }.onFailure { error.value = "Devices could not be loaded: ${it.message}" }
            busy.value = false
        }
    }

    fun refreshRecent() {
        viewModelScope.launch {
            when (val result = notifications.recent(50)) {
                is Outcome.Success -> recent.value = result.value
                is Outcome.Failure -> error.value = result.message
            }
        }
    }

    fun refreshNotificationAccess() {
        notificationAccess.value = hasNotificationAccess()
    }

    fun setSharingEnabled(enabled: Boolean) {
        viewModelScope.launch {
            if (enabled && !hasNotificationAccess()) {
                error.value = "Grant notification access first, then enable sharing"
                return@launch
            }
            notifications.setSharingEnabled(enabled)
            message.value = if (enabled) "Notifications from this device are now shared" else "Sharing stopped"
        }
    }

    fun setRelayEnabled(enabled: Boolean) {
        viewModelScope.launch {
            notifications.setRelayEnabled(enabled)
            if (enabled) {
                NotificationRelayService.start(context)
                message.value = "Relay on: notifications from your other devices will appear here"
            } else {
                NotificationRelayService.stop(context)
                message.value = "Relay off"
            }
        }
    }

    /** Consent result from the system MediaProjection dialog. */
    fun startSharingScreen(projectionPermission: Intent) {
        ScreenShareService.start(context, projectionPermission)
        message.value = "Sharing this screen — open DroidLink X on your other device to watch"
    }

    fun stopSharingScreen() {
        ScreenShareService.stop(context)
    }

    fun watch(deviceId: String, renderer: SurfaceViewRenderer) {
        mirroring.watch(deviceId, renderer)
    }

    fun stopWatching() {
        mirroring.stopWatching()
    }

    fun createRenderer(): SurfaceViewRenderer? = runCatching { mirroring.createRenderer(context) }.getOrNull()

    fun releaseRenderer(renderer: SurfaceViewRenderer) {
        runCatching { renderer.release() }
    }

    fun projectionManager(): MediaProjectionManager? =
        context.getSystemService(MediaProjectionManager::class.java)

    fun clearMessage() {
        message.value = null
        error.value = null
    }

    private fun hasNotificationAccess(): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

    override fun onCleared() {
        super.onCleared()
    }
}
