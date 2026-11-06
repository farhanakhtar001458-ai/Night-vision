package com.droidlinkx.core.network.supabase

import com.droidlinkx.core.network.BuildConfig

/**
 * Supabase project coordinates. The Android app only ever holds the public anon key: every
 * privileged operation (device secrets, chunk assembly, signed downloads) happens in Edge
 * Functions running with the service_role key server-side.
 */
data class SupabaseConfig(
    val url: String,
    val anonKey: String,
    val signalingUrl: String,
) {
    val isConfigured: Boolean get() = url.isNotBlank() && anonKey.isNotBlank()

    /** Base URL for Retrofit: always ends with a slash. */
    val baseUrl: String get() = if (url.endsWith("/")) url else "$url/"

    /** Origin of the WebRTC signalling relay, without the `/ws` suffix. */
    val signalingOrigin: String
        get() = signalingUrl
            .trim()
            .removeSuffix("/ws")
            .removeSuffix("/")
            .ifBlank { url }

    companion object {
        fun fromBuildConfig(): SupabaseConfig = SupabaseConfig(
            url = BuildConfig.SUPABASE_URL.trim().trimEnd('/'),
            anonKey = BuildConfig.SUPABASE_ANON_KEY.trim(),
            signalingUrl = BuildConfig.SIGNALING_URL,
        )
    }
}
