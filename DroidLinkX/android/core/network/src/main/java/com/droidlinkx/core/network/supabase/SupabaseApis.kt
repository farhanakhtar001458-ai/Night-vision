package com.droidlinkx.core.network.supabase

import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Headers
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Url

/** GoTrue: password grant, refresh, signup, logout and the current user. */
interface SupabaseAuthApi {
    @POST("auth/v1/signup")
    suspend fun signUp(@Body body: SupabaseSignUpRequest): SupabaseSessionDto

    @POST("auth/v1/token?grant_type=password")
    suspend fun signIn(@Body body: SupabasePasswordRequest): SupabaseSessionDto

    @POST("auth/v1/token?grant_type=refresh_token")
    suspend fun refresh(@Body body: SupabaseRefreshRequest): SupabaseSessionDto

    @POST("auth/v1/logout")
    suspend fun logout()

    @GET("auth/v1/user")
    suspend fun user(): SupabaseUserDto
}

/**
 * PostgREST. Row Level Security decides what is visible, so the app never filters by owner itself –
 * every query below is already scoped to the authenticated owner by the database.
 */
interface SupabaseRestApi {
    @GET("rest/v1/devices?select=*,device_permissions(permission,granted)&order=created_at.asc")
    suspend fun devices(): List<SupabaseDeviceRow>

    @GET("rest/v1/devices?select=*,device_permissions(permission,granted)&id=eq.{id}")
    suspend fun device(@Path("id") id: String): List<SupabaseDeviceRow>

    @Headers("Prefer: return=representation")
    @PATCH("rest/v1/devices?id=eq.{id}")
    suspend fun patchDevice(@Path("id") id: String, @Body body: Map<String, Any?>): List<SupabaseDeviceRow>

    @Headers("Prefer: return=representation,resolution=merge-duplicates")
    @POST("rest/v1/device_permissions")
    suspend fun upsertPermission(@Body body: SupabasePermissionRow): List<SupabasePermissionRow>

    @GET("rest/v1/device_permissions?select=permission,granted&device_id=eq.{id}")
    suspend fun permissions(@Path("id") id: String): List<SupabasePermissionRow>

    @GET("rest/v1/connection_events?select=*&device_id=eq.{id}&order=created_at.desc&limit=50")
    suspend fun deviceEvents(@Path("id") id: String): List<SupabaseEventRow>

    @GET("rest/v1/connection_sessions?select=*&order=created_at.desc&limit=20")
    suspend fun connections(): List<SupabaseConnectionRow>

    @Headers("Prefer: return=representation")
    @PATCH("rest/v1/connection_sessions?id=eq.{id}")
    suspend fun patchConnection(@Path("id") id: String, @Body body: Map<String, Any?>): List<SupabaseConnectionRow>

    @POST("rest/v1/connection_events")
    suspend fun insertEvent(@Body body: Map<String, Any?>)

    @GET("rest/v1/profiles?select=id,email,display_name&id=eq.{id}")
    suspend fun profile(@Path("id") id: String): List<SupabaseProfileRow>

    @GET("rest/v1/files?select=*&deleted_at=is.null&order=created_at.desc&limit=200")
    suspend fun files(): List<SupabaseFileRow>

    @DELETE("rest/v1/files?id=eq.{id}")
    suspend fun deleteFile(@Path("id") id: String)

    @GET("rest/v1/file_transfers?select=*,transfer_items(*)&order=created_at.desc&limit=25")
    suspend fun transfers(): List<SupabaseTransferRow>

    @GET("rest/v1/file_transfers?select=*,transfer_items(*)&id=eq.{id}")
    suspend fun transfer(@Path("id") id: String): List<SupabaseTransferRow>

    @Headers("Prefer: return=representation")
    @PATCH("rest/v1/file_transfers?id=eq.{id}")
    suspend fun patchTransfer(@Path("id") id: String, @Body body: Map<String, Any?>): List<SupabaseTransferRow>

    @Headers("Prefer: return=representation")
    @PATCH("rest/v1/transfer_items?transfer_id=eq.{transferId}&item_index=eq.{itemIndex}")
    suspend fun patchItem(
        @Path("transferId") transferId: String,
        @Path("itemIndex") itemIndex: Int,
        @Body body: Map<String, Any?>,
    ): List<SupabaseTransferItemRow>

    @POST("rest/v1/transfer_history")
    suspend fun insertHistory(@Body body: Map<String, Any?>)
}

/** The eight Edge Functions that make up the server-side API surface. */
interface SupabaseFunctionsApi {
    @POST("functions/v1/enroll-device")
    suspend fun enroll(@Body body: SupabaseEnrollRequest): SupabaseEnrollResponse

    @POST("functions/v1/revoke-device")
    suspend fun revoke(@Body body: SupabaseRevokeRequest): SupabaseRevokeResponse

    @POST("functions/v1/create-session")
    suspend fun createSession(@Body body: SupabaseCreateSessionRequest): SupabaseCreateSessionResponse

    @POST("functions/v1/authorize-connection")
    suspend fun authorize(@Body body: SupabaseAuthorizeRequest): SupabaseAuthorizeResponse

    @POST("functions/v1/initiate-transfer")
    suspend fun initiateTransfer(@Body body: SupabaseInitiateRequest): SupabaseInitiateResponse

    @POST("functions/v1/generate-secure-download")
    suspend fun download(@Body body: SupabaseDownloadRequest): SupabaseDownloadResponse

    @POST("functions/v1/update-device-status")
    suspend fun updateStatus(@Body body: SupabaseStatusRequest): SupabaseStatusResponse

    @POST("functions/v1/finalize-transfer")
    suspend fun finalizeTransfer(@Body body: SupabaseFinalizeRequest): SupabaseFinalizeResponse
}

/** Direct-to-Storage object writes with the caller's own JWT (never a service key). */
interface SupabaseStorageApi {
    @PUT
    suspend fun putObject(
        @Url url: String,
        @Body body: RequestBody,
        @Header("x-upsert") upsert: String = "true",
        @Header("Content-Type") contentType: String = "application/octet-stream",
    ): ResponseBody

    @GET("storage/v1/object/info/{bucket}/{path}")
    suspend fun objectInfo(
        @Path("bucket") bucket: String,
        @Path(value = "path", encoded = true) path: String,
        @Query("select") select: String = "size",
    ): ResponseBody
}
