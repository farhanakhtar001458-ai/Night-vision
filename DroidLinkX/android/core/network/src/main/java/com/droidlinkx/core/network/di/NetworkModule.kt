package com.droidlinkx.core.network.di

import com.droidlinkx.core.network.BuildConfig
import com.droidlinkx.core.network.api.DeviceApi
import com.droidlinkx.core.network.api.OwnerApi
import com.droidlinkx.core.network.api.PublicApi
import com.droidlinkx.core.network.supabase.SupabaseApis
import com.droidlinkx.core.network.supabase.SupabaseAuthApi
import com.droidlinkx.core.network.supabase.SupabaseConfig
import com.droidlinkx.core.network.supabase.SupabaseDeviceApi
import com.droidlinkx.core.network.supabase.SupabaseFunctionsApi
import com.droidlinkx.core.network.supabase.SupabaseHeadersInterceptor
import com.droidlinkx.core.network.supabase.SupabaseOwnerApi
import com.droidlinkx.core.network.supabase.SupabasePublicApi
import com.droidlinkx.core.network.supabase.SupabaseRestApi
import com.droidlinkx.core.network.supabase.SupabaseStorageApi
import com.droidlinkx.core.network.supabase.SupabaseToolsApi
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Qualifier
import javax.inject.Singleton

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class OwnerHttpClient

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class DeviceHttpClient

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class PlainHttpClient

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class OwnerApiClient

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class DeviceApiClient

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class SupabasePublicRetrofit

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class SupabaseOwnerRetrofit

@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class SupabaseDeviceRetrofit

/** Supplies the currently configured backend origin, e.g. `https://cloud.example.com/`. */
fun interface BaseUrlProvider {
    fun currentBaseUrl(): String
}

/** Supplies the owner bearer token, or null when signed out. */
fun interface OwnerTokenProvider {
    fun ownerToken(): String?
}

/** Supplies the device bearer token, or null before the device session is established. */
fun interface DeviceTokenProvider {
    fun deviceToken(): String?
}

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideMoshi(): Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    @Provides
    @Singleton
    fun provideLoggingInterceptor(): HttpLoggingInterceptor = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC else HttpLoggingInterceptor.Level.NONE
    }

    @Provides
    @Singleton
    @PlainHttpClient
    fun providePlainClient(
        logging: HttpLoggingInterceptor,
        baseUrlProvider: BaseUrlProvider,
    ): OkHttpClient = baseClientBuilder(logging)
        .addInterceptor(BaseUrlInterceptor(baseUrlProvider))
        .build()

    @Provides
    @Singleton
    @OwnerHttpClient
    fun provideOwnerClient(
        logging: HttpLoggingInterceptor,
        baseUrlProvider: BaseUrlProvider,
        tokenProvider: OwnerTokenProvider,
    ): OkHttpClient = baseClientBuilder(logging)
        .addInterceptor(BaseUrlInterceptor(baseUrlProvider))
        .addInterceptor(BearerInterceptor(tokenProvider::ownerToken))
        .build()

    @Provides
    @Singleton
    @DeviceHttpClient
    fun provideDeviceClient(
        logging: HttpLoggingInterceptor,
        baseUrlProvider: BaseUrlProvider,
        tokenProvider: DeviceTokenProvider,
    ): OkHttpClient = baseClientBuilder(logging)
        .addInterceptor(BaseUrlInterceptor(baseUrlProvider))
        .addInterceptor(BearerInterceptor(tokenProvider::deviceToken))
        .build()

    private fun baseClientBuilder(logging: HttpLoggingInterceptor): OkHttpClient.Builder =
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .pingInterval(25, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .addInterceptor(logging)

    @Provides
    @Singleton
    fun provideRetrofit(moshi: Moshi, @PlainHttpClient client: OkHttpClient): Retrofit =
        Retrofit.Builder()
            .baseUrl(sanitize(BuildConfig.API_BASE_URL))
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi).asLenient())
            .build()

    /* ---------------------------- Supabase ---------------------------- */

    @Provides
    @Singleton
    fun provideSupabaseConfig(): SupabaseConfig = SupabaseConfig.fromBuildConfig()

    private fun supabaseClient(
        logging: HttpLoggingInterceptor,
        config: SupabaseConfig,
        tokenProvider: () -> String?,
    ): OkHttpClient = baseClientBuilder(logging)
        .addInterceptor(SupabaseHeadersInterceptor(config.anonKey, tokenProvider))
        .build()

    private fun supabaseRetrofit(moshi: Moshi, client: OkHttpClient, config: SupabaseConfig): Retrofit =
        Retrofit.Builder()
            .baseUrl(config.baseUrl)
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi).asLenient())
            .build()

    @Provides
    @Singleton
    @SupabasePublicRetrofit
    fun provideSupabasePublicRetrofit(
        moshi: Moshi,
        logging: HttpLoggingInterceptor,
        config: SupabaseConfig,
    ): Retrofit = supabaseRetrofit(moshi, supabaseClient(logging, config) { null }, config)

    @Provides
    @Singleton
    @SupabaseOwnerRetrofit
    fun provideSupabaseOwnerRetrofit(
        moshi: Moshi,
        logging: HttpLoggingInterceptor,
        config: SupabaseConfig,
        tokenProvider: OwnerTokenProvider,
    ): Retrofit = supabaseRetrofit(moshi, supabaseClient(logging, config, tokenProvider::ownerToken), config)

    @Provides
    @Singleton
    @SupabaseDeviceRetrofit
    fun provideSupabaseDeviceRetrofit(
        moshi: Moshi,
        logging: HttpLoggingInterceptor,
        config: SupabaseConfig,
        tokenProvider: DeviceTokenProvider,
    ): Retrofit = supabaseRetrofit(moshi, supabaseClient(logging, config, tokenProvider::deviceToken), config)

    @Provides
    @Singleton
    fun provideSupabaseApis(
        config: SupabaseConfig,
        @SupabasePublicRetrofit publicRetrofit: Retrofit,
        @SupabaseOwnerRetrofit ownerRetrofit: Retrofit,
        @SupabaseDeviceRetrofit deviceRetrofit: Retrofit,
        ownerTokenProvider: OwnerTokenProvider,
    ): SupabaseApis = SupabaseApis(
        publicApi = SupabasePublicApi(
            config = config,
            auth = publicRetrofit.create(SupabaseAuthApi::class.java),
            functions = publicRetrofit.create(SupabaseFunctionsApi::class.java),
        ),
        ownerApi = SupabaseOwnerApi(
            config = config,
            auth = ownerRetrofit.create(SupabaseAuthApi::class.java),
            rest = ownerRetrofit.create(SupabaseRestApi::class.java),
            functions = ownerRetrofit.create(SupabaseFunctionsApi::class.java),
            ownerToken = { ownerTokenProvider.ownerToken() },
        ),
        deviceApi = SupabaseDeviceApi(
            functions = deviceRetrofit.create(SupabaseFunctionsApi::class.java),
            // Telemetry is a plain PostgREST update, so it must use the owner token: the RLS policy
            // for public.devices only lets the owner (auth.uid()) write.
            rest = ownerRetrofit.create(SupabaseRestApi::class.java),
        ),
    )

    /** Owner-scoped Retrofit for Storage uploads and PostgREST reads used by the transfer engine. */
    @Provides
    @Singleton
    fun provideSupabaseOwnerRest(@SupabaseOwnerRetrofit retrofit: Retrofit): SupabaseRestApi =
        retrofit.create(SupabaseRestApi::class.java)

    @Provides
    @Singleton
    fun provideSupabaseOwnerFunctions(@SupabaseOwnerRetrofit retrofit: Retrofit): SupabaseFunctionsApi =
        retrofit.create(SupabaseFunctionsApi::class.java)

    @Provides
    @Singleton
    fun provideSupabaseStorage(@SupabaseOwnerRetrofit retrofit: Retrofit): SupabaseStorageApi =
        retrofit.create(SupabaseStorageApi::class.java)

    /** Notification sharing + in-app signalling; owner-scoped, RLS protected. */
    @Provides
    @Singleton
    fun provideSupabaseTools(@SupabaseOwnerRetrofit retrofit: Retrofit): SupabaseToolsApi =
        retrofit.create(SupabaseToolsApi::class.java)

    @Provides
    @Singleton
    fun providePublicApi(config: SupabaseConfig, supabase: SupabaseApis, retrofit: Retrofit): PublicApi =
        if (config.isConfigured) supabase.publicApi else retrofit.create(PublicApi::class.java)

    @Provides
    @Singleton
    @OwnerApiClient
    fun provideOwnerRetrofit(moshi: Moshi, @OwnerHttpClient client: OkHttpClient): Retrofit =
        Retrofit.Builder()
            .baseUrl(sanitize(BuildConfig.API_BASE_URL))
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi).asLenient())
            .build()

    @Provides
    @Singleton
    @DeviceApiClient
    fun provideDeviceRetrofit(moshi: Moshi, @DeviceHttpClient client: OkHttpClient): Retrofit =
        Retrofit.Builder()
            .baseUrl(sanitize(BuildConfig.API_BASE_URL))
            .client(client)
            .addConverterFactory(MoshiConverterFactory.create(moshi).asLenient())
            .build()

    @Provides
    @Singleton
    fun provideOwnerApi(
        config: SupabaseConfig,
        supabase: SupabaseApis,
        @OwnerApiClient retrofit: Retrofit,
    ): OwnerApi = if (config.isConfigured) supabase.ownerApi else retrofit.create(OwnerApi::class.java)

    @Provides
    @Singleton
    fun provideDeviceApi(
        config: SupabaseConfig,
        supabase: SupabaseApis,
        @DeviceApiClient retrofit: Retrofit,
    ): DeviceApi = if (config.isConfigured) supabase.deviceApi else retrofit.create(DeviceApi::class.java)

    private fun sanitize(url: String): String = if (url.endsWith("/")) url else "$url/"
}

/** Rewrites the request origin to whatever backend the owner configured, without changing the compiled path. */
class BaseUrlInterceptor(private val provider: BaseUrlProvider) : okhttp3.Interceptor {
    override fun intercept(chain: okhttp3.Interceptor.Chain): okhttp3.Response {
        val request = chain.request()
        val base = runCatching { sanitize(provider.currentBaseUrl()) }.getOrNull() ?: return chain.proceed(request)
        val baseUrl = base.toHttpUrlOrNull() ?: return chain.proceed(request)
        val rewritten = request.url.newBuilder()
            .scheme(baseUrl.scheme)
            .host(baseUrl.host)
            .port(baseUrl.port)
            .build()
        return chain.proceed(request.newBuilder().url(rewritten).build())
    }

    private fun sanitize(url: String): String = if (url.endsWith("/")) url else "$url/"
}

class BearerInterceptor(private val tokenProvider: () -> String?) : okhttp3.Interceptor {
    override fun intercept(chain: okhttp3.Interceptor.Chain): okhttp3.Response {
        val token = tokenProvider()
        val request = if (token.isNullOrBlank()) {
            chain.request()
        } else {
            chain.request().newBuilder().header("Authorization", "Bearer $token").build()
        }
        return chain.proceed(request)
    }
}
