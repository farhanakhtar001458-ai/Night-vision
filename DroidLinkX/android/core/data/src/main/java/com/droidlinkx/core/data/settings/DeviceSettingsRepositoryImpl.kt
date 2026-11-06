package com.droidlinkx.core.data.settings

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.droidlinkx.core.data.BuildConfig
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.repository.DeviceSettingsRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "droidlinkx.settings")

@Singleton
class DeviceSettingsRepositoryImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    private val baseUrlCache: BaseUrlCache,
) : DeviceSettingsRepository {

    private object Keys {
        val API_BASE_URL = stringPreferencesKey("api_base_url")
        val TELEMETRY_INTERVAL = longPreferencesKey("telemetry_interval_seconds")
        val KEEP_ALIVE = booleanPreferencesKey("keep_alive_enabled")
    }

    override fun observeApiBaseUrl(): Flow<String> =
        context.dataStore.data.map { preferences ->
            val url = preferences[Keys.API_BASE_URL] ?: BuildConfig.DEFAULT_API_BASE_URL
            baseUrlCache.baseUrl = url
            url
        }

    override suspend fun setApiBaseUrl(url: String): Outcome<Unit> {
        val normalized = url.trim()
        if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
            return Outcome.Failure("The server URL must start with http:// or https://")
        }
        val isLocal = listOf("10.0.2.2", "192.168.", "127.0.0.1", "localhost").any { normalized.contains(it) }
        if (normalized.startsWith("http://") && !isLocal) {
            return Outcome.Failure("Plain HTTP is only allowed for local development addresses. Use HTTPS for public servers.")
        }
        val stored = if (normalized.endsWith("/")) normalized else "$normalized/"
        baseUrlCache.baseUrl = stored
        context.dataStore.edit { it[Keys.API_BASE_URL] = stored }
        return Outcome.Success(Unit)
    }

    override fun observeTelemetryIntervalSeconds(): Flow<Long> =
        context.dataStore.data.map { it[Keys.TELEMETRY_INTERVAL] ?: DEFAULT_INTERVAL_SECONDS }

    override suspend fun setTelemetryIntervalSeconds(seconds: Long) {
        context.dataStore.edit { it[Keys.TELEMETRY_INTERVAL] = seconds.coerceIn(30L, 900L) }
    }

    override fun observeKeepAliveEnabled(): Flow<Boolean> =
        context.dataStore.data.map { it[Keys.KEEP_ALIVE] ?: true }

    override suspend fun setKeepAliveEnabled(enabled: Boolean) {
        context.dataStore.edit { it[Keys.KEEP_ALIVE] = enabled }
    }

    suspend fun currentBaseUrl(): String =
        context.dataStore.data.map { it[Keys.API_BASE_URL] ?: BuildConfig.DEFAULT_API_BASE_URL }.first()

    companion object {
        private const val DEFAULT_INTERVAL_SECONDS = 60L
    }
}
