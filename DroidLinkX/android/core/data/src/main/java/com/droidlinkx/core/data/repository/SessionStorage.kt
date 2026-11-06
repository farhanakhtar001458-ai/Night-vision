package com.droidlinkx.core.data.repository

import com.droidlinkx.core.domain.model.OwnerProfile
import com.droidlinkx.core.domain.model.OwnerSession
import com.droidlinkx.core.domain.model.OwnerTokens
import com.droidlinkx.core.security.CredentialVault
import org.json.JSONObject
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Single source of truth for persisted identity. Everything written here is encrypted by the
 * Keystore-backed vault; no token, secret or password is stored in plain text.
 */
@Singleton
class SessionStorage @Inject constructor(private val vault: CredentialVault) {

    /* ------------------------------ owner ------------------------------ */

    fun ownerSession(): OwnerSession? {
        val raw = vault.get(KEY_OWNER_SESSION) ?: return null
        return runCatching {
            val json = JSONObject(raw)
            val tokens = json.getJSONObject("tokens")
            OwnerSession(
                profile = OwnerProfile(
                    id = json.getString("id"),
                    email = json.getString("email"),
                    displayName = json.getString("displayName"),
                ),
                tokens = OwnerTokens(
                    accessToken = tokens.getString("accessToken"),
                    refreshToken = tokens.getString("refreshToken"),
                    accessExpiresAtEpochMillis = tokens.getLong("expiresAt"),
                ),
            )
        }.getOrNull()
    }

    fun saveOwnerSession(session: OwnerSession) {
        val json = JSONObject()
            .put("id", session.profile.id)
            .put("email", session.profile.email)
            .put("displayName", session.profile.displayName)
            .put(
                "tokens",
                JSONObject()
                    .put("accessToken", session.tokens.accessToken)
                    .put("refreshToken", session.tokens.refreshToken)
                    .put("expiresAt", session.tokens.accessExpiresAtEpochMillis),
            )
        vault.put(KEY_OWNER_SESSION, json.toString())
    }

    fun clearOwnerSession() {
        vault.remove(KEY_OWNER_SESSION)
    }

    /* ------------------------------ device ----------------------------- */

    data class DeviceCredentials(
        val deviceId: String,
        val secret: String,
        val name: String,
        val wsUrl: String,
        val enrolledAtEpochMillis: Long,
    )

    data class DeviceSession(val accessToken: String, val sessionId: String, val expiresAtEpochMillis: Long)

    /** Stable per-installation identifier generated before any network call. */
    fun installationId(): String {
        vault.get(KEY_INSTALLATION_ID)?.let { return it }
        val generated = UUID.randomUUID().toString()
        vault.put(KEY_INSTALLATION_ID, generated)
        return generated
    }

    fun deviceCredentials(): DeviceCredentials? {
        val raw = vault.get(KEY_DEVICE_CREDENTIALS) ?: return null
        return runCatching {
            val json = JSONObject(raw)
            DeviceCredentials(
                deviceId = json.getString("deviceId"),
                secret = json.getString("secret"),
                name = json.getString("name"),
                wsUrl = json.getString("wsUrl"),
                enrolledAtEpochMillis = json.getLong("enrolledAt"),
            )
        }.getOrNull()
    }

    fun saveDeviceCredentials(credentials: DeviceCredentials) {
        val json = JSONObject()
            .put("deviceId", credentials.deviceId)
            .put("secret", credentials.secret)
            .put("name", credentials.name)
            .put("wsUrl", credentials.wsUrl)
            .put("enrolledAt", credentials.enrolledAtEpochMillis)
        vault.put(KEY_DEVICE_CREDENTIALS, json.toString())
    }

    fun deviceSession(): DeviceSession? {
        val raw = vault.get(KEY_DEVICE_SESSION) ?: return null
        return runCatching {
            val json = JSONObject(raw)
            DeviceSession(
                accessToken = json.getString("accessToken"),
                sessionId = json.getString("sessionId"),
                expiresAtEpochMillis = json.getLong("expiresAt"),
            )
        }.getOrNull()
    }

    fun saveDeviceSession(session: DeviceSession) {
        val json = JSONObject()
            .put("accessToken", session.accessToken)
            .put("sessionId", session.sessionId)
            .put("expiresAt", session.expiresAtEpochMillis)
        vault.put(KEY_DEVICE_SESSION, json.toString())
    }

    fun clearDeviceSession() {
        vault.remove(KEY_DEVICE_SESSION)
    }

    fun forgetDevice() {
        vault.remove(KEY_DEVICE_CREDENTIALS)
        vault.remove(KEY_DEVICE_SESSION)
    }

    companion object {
        private const val KEY_OWNER_SESSION = "owner.session"
        private const val KEY_DEVICE_CREDENTIALS = "device.credentials"
        private const val KEY_DEVICE_SESSION = "device.session"
        private const val KEY_INSTALLATION_ID = "installation.id"
    }
}
