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

    /** Base URL for Retrofit: always an absolute http(s) URL ending with a slash. */
    val baseUrl: String
        get() = when {
            !url.startsWith("http") -> "$FALLBACK_URL/"
            url.endsWith("/") -> url
            else -> "$url/"
        }

    /** Origin of the WebRTC signalling relay, without the `/ws` suffix. */
    val signalingOrigin: String
        get() = signalingUrl
            .trim()
            .removeSuffix("/ws")
            .removeSuffix("/")
            .ifBlank { url }

    companion object {
        /**
         * Last line of defence: a build that somehow produced an empty — or the literal string
         * `"null"` — coordinate must still talk to the real project instead of crashing Retrofit
         * with "Expected URL scheme 'http' or 'https'".
         */
        const val FALLBACK_URL = "https://zarxnrkzdwnjiauybghl.supabase.co"
        const val FALLBACK_ANON_KEY =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inphcnhucmt6ZHduamlhdXliZ2hsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NzQ1OTUsImV4cCI6MjEwODM1MDU5NX0.dcdHLqwF75YfEOTT2H9Vw-MN0Sr1UzIOzoGYTaB7r2s"

        private fun usable(value: String?): String? =
            value?.trim()?.takeIf { it.isNotEmpty() && !it.equals("null", ignoreCase = true) }

        fun fromBuildConfig(): SupabaseConfig {
            val url = (usable(BuildConfig.SUPABASE_URL) ?: FALLBACK_URL).trimEnd('/')
            val anonKey = usable(BuildConfig.SUPABASE_ANON_KEY) ?: FALLBACK_ANON_KEY
            return SupabaseConfig(
                url = if (url.startsWith("http")) url else FALLBACK_URL,
                anonKey = anonKey,
                signalingUrl = usable(BuildConfig.SIGNALING_URL).orEmpty(),
            )
        }
    }
}
