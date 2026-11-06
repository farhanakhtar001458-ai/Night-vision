package com.droidlinkx.core.network.supabase

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression guard for the launch crash where Retrofit was handed a scheme-less base URL
 * ("Expected URL scheme 'http' or 'https' but no scheme was found for null/") because the Gradle
 * defaults were interpolated before they were initialised.
 */
class SupabaseConfigTest {

    @Test
    fun `base url is always an absolute http url`() {
        val configs = listOf(
            SupabaseConfig(url = "", anonKey = "", signalingUrl = ""),
            SupabaseConfig(url = "null", anonKey = "null", signalingUrl = ""),
            SupabaseConfig(url = "   ", anonKey = "key", signalingUrl = ""),
            SupabaseConfig(url = "https://zarxnrkzdwnjiauybghl.supabase.co", anonKey = "key", signalingUrl = ""),
            SupabaseConfig(url = "http://10.0.2.2:54321", anonKey = "key", signalingUrl = ""),
        )

        configs.forEach { config ->
            assertTrue("scheme missing for '${config.url}': ${config.baseUrl}", config.baseUrl.startsWith("http"))
            assertTrue("base url must end with a slash: ${config.baseUrl}", config.baseUrl.endsWith("/"))
        }
    }

    @Test
    fun `degraded config falls back to the real project`() {
        val config = SupabaseConfig(url = "null", anonKey = "null", signalingUrl = "")
        assertEquals("${SupabaseConfig.FALLBACK_URL}/", config.baseUrl)
    }

    @Test
    fun `build config coordinates are usable`() {
        val config = SupabaseConfig.fromBuildConfig()
        assertTrue(
            "SUPABASE_URL was not baked into the APK correctly: '${config.url}'",
            config.url.startsWith("https://") && !config.url.contains("null"),
        )
        assertTrue(
            "SUPABASE_ANON_KEY was not baked into the APK correctly (length ${config.anonKey.length})",
            config.anonKey.startsWith("eyJ") && config.anonKey.length > 100,
        )
        assertEquals("${config.url}/", config.baseUrl)
    }

    @Test
    fun `identical urls normalise to one base url`() {
        val withSlash = SupabaseConfig("https://example.supabase.co/", "key", "")
        val withoutSlash = SupabaseConfig("https://example.supabase.co", "key", "")
        assertEquals(withSlash.baseUrl, withoutSlash.baseUrl)
    }
}
