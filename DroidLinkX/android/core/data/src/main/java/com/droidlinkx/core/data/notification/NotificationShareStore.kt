package com.droidlinkx.core.data.notification

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Opt-in flags and delivery watermark for notification sharing. Both flags default to `false`:
 * nothing is read, uploaded or displayed until the owner turns sharing on explicitly.
 */
@Singleton
class NotificationShareStore @Inject constructor(@ApplicationContext context: Context) {

    private val prefs = context.getSharedPreferences("droidlinkx.notifications", Context.MODE_PRIVATE)

    private val _sharing = MutableStateFlow(prefs.getBoolean(KEY_SHARING, false))
    val sharing: StateFlow<Boolean> = _sharing.asStateFlow()

    private val _relay = MutableStateFlow(prefs.getBoolean(KEY_RELAY, false))
    val relay: StateFlow<Boolean> = _relay.asStateFlow()

    fun setSharingEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_SHARING, enabled).apply()
        _sharing.value = enabled
    }

    fun setRelayEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_RELAY, enabled).apply()
        _relay.value = enabled
    }

    var lastDeliveredPostedAt: String
        get() = prefs.getString(KEY_DELIVERED, "").orEmpty()
        set(value) {
            prefs.edit().putString(KEY_DELIVERED, value).apply()
        }

    companion object {
        private const val KEY_SHARING = "sharing.enabled"
        private const val KEY_RELAY = "relay.enabled"
        private const val KEY_DELIVERED = "relay.lastDelivered"
    }
}
