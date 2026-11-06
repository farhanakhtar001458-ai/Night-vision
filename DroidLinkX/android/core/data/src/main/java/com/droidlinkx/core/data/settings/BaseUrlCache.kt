package com.droidlinkx.core.data.settings

import com.droidlinkx.core.data.BuildConfig
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Synchronous, in-memory mirror of the configured backend origin so OkHttp interceptors and the
 * WebSocket URL builder never block on DataStore reads.
 */
@Singleton
class BaseUrlCache @Inject constructor() {
    @Volatile
    var baseUrl: String = BuildConfig.DEFAULT_API_BASE_URL
}
