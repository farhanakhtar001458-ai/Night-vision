package com.droidlinkx.core.domain.repository

import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.SharedNotification
import kotlinx.coroutines.flow.Flow

/**
 * Shares notifications captured on this device with the owner's other devices and reads the ones
 * they shared. Nothing leaves the device unless the owner explicitly enables sharing.
 */
interface NotificationShareRepository {
    val sharingEnabled: Flow<Boolean>
    val relayEnabled: Flow<Boolean>

    suspend fun setSharingEnabled(enabled: Boolean)
    suspend fun setRelayEnabled(enabled: Boolean)

    /** Called by the notification listener, only after the owner opted in. */
    suspend fun share(notification: SharedNotification): Outcome<Unit>

    /** Notifications posted by the owner's *other* devices since the delivered marker. */
    suspend fun pendingFromOtherDevices(): Outcome<List<SharedNotification>>

    suspend fun markDelivered(postedAt: String)
    suspend fun recent(limit: Int = 50): Outcome<List<SharedNotification>>
}
