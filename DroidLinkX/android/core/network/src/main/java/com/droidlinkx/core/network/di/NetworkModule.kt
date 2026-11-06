package com.droidlinkx.core.network.di

import com.droidlinkx.core.network.BuildConfig
import com.droidlinkx.core.network.api.DeviceApi
import com.droidlinkx.core.network.api.OwnerApi
import com.droidlinkx.core.network.api.PublicApi
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

    @Provides
    @Singleton
    fun providePublicApi(retrofit: Retrofit): PublicApi = retrofit.create(PublicApi::class.java)

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
    fun provideOwnerApi(@OwnerApiClient retrofit: Retrofit): OwnerApi = retrofit.create(OwnerApi::class.java)

    @Provides
    @Singleton
    fun provideDeviceApi(@DeviceApiClient retrofit: Retrofit): DeviceApi = retrofit.create(DeviceApi::class.java)

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
