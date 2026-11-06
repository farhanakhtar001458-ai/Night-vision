package com.droidlinkx.core.data.notification

import com.droidlinkx.core.data.repository.SessionStorage
import com.droidlinkx.core.data.util.outcomeOf
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.SharedNotification
import com.droidlinkx.core.domain.repository.NotificationShareRepository
import com.droidlinkx.core.network.supabase.SupabaseNotificationInsert
import com.droidlinkx.core.network.supabase.SupabaseNotificationRow
import com.droidlinkx.core.network.supabase.SupabaseToolsApi
import kotlinx.coroutines.flow.Flow
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NotificationShareRepositoryImpl @Inject constructor(
    private val tools: SupabaseToolsApi,
    private val sessionStorage: SessionStorage,
    private val store: NotificationShareStore,
) : NotificationShareRepository {

    override val sharingEnabled: Flow<Boolean> = store.sharing
    override val relayEnabled: Flow<Boolean> = store.relay

    override suspend fun setSharingEnabled(enabled: Boolean) = store.setSharingEnabled(enabled)

    override suspend fun setRelayEnabled(enabled: Boolean) = store.setRelayEnabled(enabled)

    override suspend fun share(notification: SharedNotification): Outcome<Unit> = outcomeOf {
        val ownerId = ownerId()
        tools.insertNotifications(
            rows = listOf(
                SupabaseNotificationInsert(
                    ownerId = ownerId,
                    deviceId = notification.deviceId,
                    packageName = notification.packageName,
                    appName = notification.appName,
                    title = notification.title,
                    content = notification.content,
                    category = notification.category,
                    isSensitive = notification.isSensitive,
                    postedAt = notification.postedAt,
                    externalKey = notification.id,
                ),
            ),
        )
        Unit
    }

    override suspend fun pendingFromOtherDevices(): Outcome<List<SharedNotification>> = outcomeOf {
        val myDevice = sessionStorage.deviceCredentials()?.deviceId
        val since = store.lastDeliveredPostedAt.ifBlank {
            Instant.now().minus(6, ChronoUnit.HOURS).toString()
        }
        tools.notificationsSince(
            postedAfter = "gt.$since",
            notDevice = myDevice?.let { "not.eq.$it" } ?: "not.is.null",
        ).map { it.toDomain() }
    }

    override suspend fun markDelivered(postedAt: String) {
        if (postedAt > store.lastDeliveredPostedAt) store.lastDeliveredPostedAt = postedAt
    }

    override suspend fun recent(limit: Int): Outcome<List<SharedNotification>> = outcomeOf {
        val since = Instant.now().minus(24, ChronoUnit.HOURS).toString()
        tools.notificationsSince(postedAfter = "gt.$since", notDevice = "not.is.null")
            .take(limit)
            .map { it.toDomain() }
    }

    private fun ownerId(): String = sessionStorage.ownerSession()?.profile?.id
        ?: throw IllegalStateException("Sign in with the owner account to share notifications")

    private fun SupabaseNotificationRow.toDomain(): SharedNotification = SharedNotification(
        id = id,
        deviceId = deviceId,
        appName = appName,
        packageName = packageName,
        title = title,
        content = content,
        category = category,
        isSensitive = isSensitive,
        postedAt = postedAt,
    )
}
