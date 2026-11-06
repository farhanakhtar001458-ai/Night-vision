package com.droidlinkx.core.domain.model

/** A notification captured on one of the owner's devices and shared with the others. */
data class SharedNotification(
    val id: String,
    val deviceId: String,
    val appName: String,
    val packageName: String,
    val title: String?,
    val content: String?,
    val category: String?,
    val isSensitive: Boolean,
    val postedAt: String,
)

/** Lifecycle of a phone-to-phone screen share. */
data class MirroringState(
    val sharing: Boolean = false,
    val watching: Boolean = false,
    val connectionId: String? = null,
    val remoteDeviceId: String? = null,
    val status: String = STATUS_IDLE,
    val detail: String? = null,
    val iceState: String? = null,
) {
    val active: Boolean get() = sharing || watching

    companion object {
        const val STATUS_IDLE = "idle"
        const val STATUS_WAITING = "waiting"
        const val STATUS_CONNECTING = "connecting"
        const val STATUS_CONNECTED = "connected"
        const val STATUS_STOPPED = "stopped"
        const val STATUS_FAILED = "failed"
    }
}
