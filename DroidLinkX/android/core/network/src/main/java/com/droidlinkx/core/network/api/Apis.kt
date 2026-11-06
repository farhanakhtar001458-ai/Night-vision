package com.droidlinkx.core.network.api

import com.droidlinkx.core.network.dto.AuthResponseDto
import com.droidlinkx.core.network.dto.ConnectionCreateRequestDto
import com.droidlinkx.core.network.dto.ConnectionEnvelopeDto
import com.droidlinkx.core.network.dto.ConnectionHistoryDto
import com.droidlinkx.core.network.dto.ConnectionStatusDto
import com.droidlinkx.core.network.dto.DeviceEnvelopeDto
import com.droidlinkx.core.network.dto.DeviceListDto
import com.droidlinkx.core.network.dto.DeviceStatusRequestDto
import com.droidlinkx.core.network.dto.DeviceTokenRequestDto
import com.droidlinkx.core.network.dto.DeviceTokenResponseDto
import com.droidlinkx.core.network.dto.EnrollRequestDto
import com.droidlinkx.core.network.dto.EnrollResponseDto
import com.droidlinkx.core.network.dto.IceServersDto
import com.droidlinkx.core.network.dto.LoginRequestDto
import com.droidlinkx.core.network.dto.LogoutRequestDto
import com.droidlinkx.core.network.dto.MeResponseDto
import com.droidlinkx.core.network.dto.PermissionRequestDto
import com.droidlinkx.core.network.dto.PermissionResponseDto
import com.droidlinkx.core.network.dto.RefreshRequestDto
import com.droidlinkx.core.network.dto.RegisterRequestDto
import com.droidlinkx.core.network.dto.TerminateConnectionRequestDto
import com.droidlinkx.core.network.dto.UpdateDeviceRequestDto
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/** Endpoints that never require a bearer token. */
interface PublicApi {
    @POST("api/auth/register")
    suspend fun register(@Body body: RegisterRequestDto): AuthResponseDto

    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequestDto): AuthResponseDto

    @POST("api/auth/refresh")
    suspend fun refresh(@Body body: RefreshRequestDto): AuthResponseDto

    @POST("api/devices/token")
    suspend fun exchangeDeviceSecret(@Body body: DeviceTokenRequestDto): DeviceTokenResponseDto

    @GET("api/health")
    suspend fun health(): Map<String, Any?>
}

/** Owner-scoped endpoints; the owner access token is attached by an interceptor. */
interface OwnerApi {
    @GET("api/auth/me")
    suspend fun me(): MeResponseDto

    @POST("api/auth/logout")
    suspend fun logout(@Body body: LogoutRequestDto)

    @POST("api/devices/enroll")
    suspend fun enrollDevice(@Body body: EnrollRequestDto): EnrollResponseDto

    @GET("api/devices")
    suspend fun devices(): DeviceListDto

    @GET("api/devices/{id}")
    suspend fun device(@Path("id") id: String): DeviceEnvelopeDto

    @PATCH("api/devices/{id}")
    suspend fun updateDevice(@Path("id") id: String, @Body body: UpdateDeviceRequestDto): DeviceEnvelopeDto

    @DELETE("api/devices/{id}")
    suspend fun revokeDevice(@Path("id") id: String)

    @PUT("api/devices/{id}/permissions/{permission}")
    suspend fun updatePermission(
        @Path("id") id: String,
        @Path("permission") permission: String,
        @Body body: PermissionRequestDto,
    ): PermissionResponseDto

    @GET("api/devices/{id}/history")
    suspend fun connectionHistory(@Path("id") id: String): ConnectionHistoryDto

    @POST("api/connections/create")
    suspend fun createConnection(@Body body: ConnectionCreateRequestDto): ConnectionEnvelopeDto

    @GET("api/connections/status")
    suspend fun connectionStatus(@Query("deviceId") deviceId: String? = null): ConnectionStatusDto

    @HTTP(method = "POST", path = "api/connections/terminate", hasBody = true)
    suspend fun terminateConnection(@Body body: TerminateConnectionRequestDto)

    @GET("api/connections/ice")
    suspend fun iceServers(@Query("connectionId") connectionId: String): IceServersDto
}

/** Device-agent endpoints; the device bearer token is attached by an interceptor. */
interface DeviceApi {
    @POST("api/devices/{id}/status")
    suspend fun reportStatus(@Path("id") deviceId: String, @Body body: DeviceStatusRequestDto): DeviceEnvelopeDto
}
