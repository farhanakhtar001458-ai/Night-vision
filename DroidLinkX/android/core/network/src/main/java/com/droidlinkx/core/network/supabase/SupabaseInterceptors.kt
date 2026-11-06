package com.droidlinkx.core.network.supabase

import okhttp3.Interceptor

/**
 * Adds the public anon key to every Supabase call and the caller's bearer token when one exists.
 * The service_role key is never part of the app: RLS plus Edge Functions do the privileged work.
 */
class SupabaseHeadersInterceptor(
    private val anonKey: String,
    private val tokenProvider: () -> String?,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val builder = chain.request().newBuilder().header("apikey", anonKey)
        val token = runCatching { tokenProvider() }.getOrNull()
        if (!token.isNullOrBlank()) {
            builder.header("Authorization", "Bearer $token")
        }
        builder.header("Accept", "application/json")
        return chain.proceed(builder.build())
    }
}
