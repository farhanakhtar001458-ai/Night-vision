package com.droidlinkx.core.network.supabase

import android.util.Base64
import com.droidlinkx.core.network.api.DeviceApi
import com.droidlinkx.core.network.api.OwnerApi
import com.droidlinkx.core.network.api.PublicApi
import com.droidlinkx.core.network.dto.AuthResponseDto
import com.droidlinkx.core.network.dto.ConnectionCreateRequestDto
import com.droidlinkx.core.network.dto.ConnectionDto
import com.droidlinkx.core.network.dto.ConnectionEnvelopeDto
import com.droidlinkx.core.network.dto.ConnectionHistoryDto
import com.droidlinkx.core.network.dto.ConnectionHistoryEntryDto
import com.droidlinkx.core.network.dto.ConnectionStatusDto
import com.droidlinkx.core.network.dto.CountsDto
import com.droidlinkx.core.network.dto.DeviceDto
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
import com.droidlinkx.core.network.dto.SignalingConfigDto
import com.droidlinkx.core.network.dto.TerminateConnectionRequestDto
import com.droidlinkx.core.network.dto.TokenPayloadDto
import com.droidlinkx.core.network.dto.TurnCredentialsDto
import com.droidlinkx.core.network.dto.UpdateDeviceRequestDto
import com.droidlinkx.core.network.dto.UserDto
import org.json.JSONObject
import retrofit2.HttpException
import java.io.IOException
import java.time.Instant

/** Decodes the `sub` claim of a Supabase access token without verifying it (the server verifies). */
internal fun ownerIdFromToken(token: String?): String? {
    if (token.isNullOrBlank()) return null
    return runCatching {
        val payload = token.split('.')[1]
        val json = String(Base64.decode(payload, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING))
        JSONObject(json).optString("sub").takeIf { it.isNotBlank() }
    }.getOrNull()
}

private fun SupabaseDeviceRow.toDto(): DeviceDto = DeviceDto(
    id = id,
    name = name,
    manufacturer = manufacturer,
    model = model,
    androidVersion = androidVersion,
    sdkInt = sdkInt,
    appVersion = appVersion,
    platform = platform ?: "android",
    status = status ?: "active",
    trusted = trusted,
    online = online,
    connectionQuality = connectionQuality ?: if (online) "good" else "offline",
    lastSeenAt = lastSeenAt,
    createdAt = createdAt,
    telemetry = telemetry,
    permissions = permissions.associate { it.permission to it.granted },
)

private fun SupabaseConnectionRow.toDto(turn: TurnCredentialsDto? = null): ConnectionDto = ConnectionDto(
    id = id,
    sourceDeviceId = sourceDeviceId,
    targetDeviceId = targetDeviceId,
    type = type,
    status = status,
    requestedBy = requestedBy ?: "user",
    createdAt = createdAt,
    expiresAt = expiresAt,
    turn = turn,
)

private fun turnFrom(iceServers: List<Map<String, Any?>>, ttl: Long?): TurnCredentialsDto? {
    val turn = iceServers.firstOrNull { entry ->
        (entry["urls"] as? List<*>)?.any { url -> url is String && url.startsWith("turn") } == true
    } ?: return null
    val urls = (turn["urls"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList()
    return TurnCredentialsDto(
        urls = urls,
        username = turn["username"] as? String ?: "",
        credential = turn["credential"] as? String ?: "",
        ttl = ttl ?: 0,
    )
}

private fun SupabaseUserDto.toDto(): UserDto = UserDto(
    id = id,
    email = email ?: "",
    displayName = (userMetadata["display_name"] as? String)?.takeIf { it.isNotBlank() }
        ?: email?.substringBefore('@')
        ?: "Owner",
    status = "active",
    createdAt = createdAt,
    lastLoginAt = lastSignInAt,
)

private fun SupabaseSessionDto.toAuthResponse(): AuthResponseDto {
    val user = user ?: throw IllegalStateException("Supabase returned a session without a user")
    if (accessToken.isBlank()) throw IllegalStateException("Confirm your email address before signing in")
    return AuthResponseDto(
        user = user.toDto(),
        tokens = TokenPayloadDto(
            accessToken = accessToken,
            expiresIn = expiresIn,
            refreshToken = refreshToken,
            refreshExpiresIn = 0,
            tokenType = "Bearer",
        ),
    )
}

/**
 * Implements the app's existing transport contracts on top of Supabase. Feature modules and
 * repositories stay untouched: auth is GoTrue, data is PostgREST under RLS, and every privileged
 * operation is an Edge Function call.
 */
class SupabasePublicApi(
    private val config: SupabaseConfig,
    private val auth: SupabaseAuthApi,
    private val functions: SupabaseFunctionsApi,
) : PublicApi {

    override suspend fun register(body: RegisterRequestDto): AuthResponseDto = auth.signUp(
        SupabaseSignUpRequest(
            email = body.email,
            password = body.password,
            data = mapOf("display_name" to body.displayName),
        ),
    ).toAuthResponse()

    override suspend fun login(body: LoginRequestDto): AuthResponseDto =
        auth.signIn(SupabasePasswordRequest(body.email, body.password)).toAuthResponse()

    override suspend fun refresh(body: RefreshRequestDto): AuthResponseDto =
        auth.refresh(SupabaseRefreshRequest(body.refreshToken)).toAuthResponse()

    override suspend fun exchangeDeviceSecret(body: DeviceTokenRequestDto): DeviceTokenResponseDto {
        val response = functions.createSession(
            SupabaseCreateSessionRequest(
                deviceId = body.deviceId,
                deviceSecret = body.deviceSecret,
                userAgent = "DroidLinkX-Android",
            ),
        )
        return DeviceTokenResponseDto(
            accessToken = response.accessToken,
            expiresIn = response.expiresIn,
            tokenType = response.tokenType ?: "Bearer",
            device = response.device?.toDto() ?: DeviceDto(id = body.deviceId, name = "Android device"),
            wsUrl = response.signaling?.signalingUrl?.takeIf { it.isNotBlank() } ?: config.signalingOrigin,
            sessionId = response.sessionId,
        )
    }

    override suspend fun health(): Map<String, Any?> = mapOf(
        "status" to "ok",
        "supabase" to config.url,
        "signaling" to config.signalingOrigin,
        "time" to Instant.now().toString(),
    )
}

class SupabaseOwnerApi(
    private val config: SupabaseConfig,
    private val auth: SupabaseAuthApi,
    private val rest: SupabaseRestApi,
    private val functions: SupabaseFunctionsApi,
    private val ownerToken: () -> String?,
) : OwnerApi {

    @Volatile
    private var lastSignaling: SupabaseSignalingDto? = null

    override suspend fun me(): MeResponseDto {
        val user = auth.user()
        val devices = runCatching { rest.devices() }.getOrDefault(emptyList())
        val profile = runCatching { rest.profile(user.id).firstOrNull() }.getOrNull()
        val displayName = profile?.displayName?.takeIf { it.isNotBlank() }
            ?: (user.userMetadata["display_name"] as? String)
            ?: user.email?.substringBefore('@')
            ?: "Owner"
        return MeResponseDto(
            user = user.toDto().copy(displayName = displayName),
            counts = CountsDto(devices = devices.size, online = devices.count { it.online }),
        )
    }

    override suspend fun logout(body: LogoutRequestDto) {
        runCatching { auth.logout() }
    }

    override suspend fun enrollDevice(body: EnrollRequestDto): EnrollResponseDto {
        val response = functions.enroll(
            SupabaseEnrollRequest(
                name = body.name,
                manufacturer = body.manufacturer,
                model = body.model,
                androidVersion = body.androidVersion,
                sdkInt = body.sdkInt,
                appVersion = body.appVersion,
                platform = body.platform,
            ),
        )
        lastSignaling = response.signaling
        return EnrollResponseDto(
            device = response.device.toDto().copy(permissions = response.permissions),
            deviceId = response.deviceId,
            deviceSecret = response.deviceSecret,
            wsUrl = response.signaling?.signalingUrl?.takeIf { it.isNotBlank() } ?: config.signalingOrigin,
        )
    }

    override suspend fun devices(): DeviceListDto = DeviceListDto(rest.devices().map { it.toDto() })

    override suspend fun device(id: String): DeviceEnvelopeDto {
        val row = rest.device(id).firstOrNull() ?: throw HttpException(
            retrofit2.Response.error<Any>(404, okhttp3.ResponseBody.create(null, """{"error":"not found"}""")),
        )
        return DeviceEnvelopeDto(row.toDto())
    }

    override suspend fun updateDevice(id: String, body: UpdateDeviceRequestDto): DeviceEnvelopeDto {
        val patch = buildMap<String, Any?> {
            body.name?.let { put("name", it) }
            body.trusted?.let { put("trusted", it) }
        }
        val row = rest.patchDevice(id, patch).firstOrNull()
            ?: throw IOException("The device update returned no row")
        return DeviceEnvelopeDto(row.toDto())
    }

    override suspend fun revokeDevice(id: String) {
        functions.revoke(SupabaseRevokeRequest(deviceId = id, delete = true))
    }

    override suspend fun updatePermission(
        id: String,
        permission: String,
        body: PermissionRequestDto,
    ): PermissionResponseDto {
        rest.upsertPermission(SupabasePermissionRow(permission = permission, granted = body.granted))
        val permissions = rest.permissions(id).associate { it.permission to it.granted }
        return PermissionResponseDto(permissions = permissions)
    }

    override suspend fun connectionHistory(id: String): ConnectionHistoryDto = ConnectionHistoryDto(
        events = rest.deviceEvents(id).map { row ->
            ConnectionHistoryEntryDto(
                id = row.id,
                connectionId = row.connectionId,
                event = row.event,
                detail = row.detail,
                createdAt = row.createdAt,
            )
        },
    )

    override suspend fun createConnection(body: ConnectionCreateRequestDto): ConnectionEnvelopeDto {
        val response = functions.authorize(
            SupabaseAuthorizeRequest(
                sourceDeviceId = body.sourceDeviceId,
                targetDeviceId = body.targetDeviceId,
                type = body.type,
            ),
        )
        lastSignaling = response.signaling
        return ConnectionEnvelopeDto(
            connection = response.connection.toDto(turn = turnFrom(response.iceServers, response.ttl)),
        )
    }

    override suspend fun connectionStatus(deviceId: String?): ConnectionStatusDto {
        val rows = rest.connections()
            .filter { deviceId == null || it.sourceDeviceId == deviceId || it.targetDeviceId == deviceId }
        val signaling = lastSignaling
        return ConnectionStatusDto(
            connections = rows.map { it.toDto() },
            config = SignalingConfigDto(
                turnConfigured = signaling?.turnConfigured ?: false,
                stunUrls = signaling?.stunUrls ?: emptyList(),
                turnUrls = signaling?.turnUrls ?: emptyList(),
                signalingUrl = signaling?.signalingUrl?.takeIf { it.isNotBlank() } ?: config.signalingOrigin,
            ),
        )
    }

    override suspend fun terminateConnection(body: TerminateConnectionRequestDto) {
        val endedAt = Instant.now().toString()
        val row = rest.patchConnection(
            body.connectionId,
            mapOf(
                "status" to "ended",
                "ended_at" to endedAt,
                "ended_reason" to (body.reason ?: "user_hangup"),
            ),
        ).firstOrNull()
        val ownerId = ownerIdFromToken(ownerToken())
        if (row != null && ownerId != null) {
            runCatching {
                rest.insertEvent(
                    mapOf(
                        "connection_id" to row.id,
                        "owner_id" to ownerId,
                        "device_id" to (row.targetDeviceId ?: row.sourceDeviceId),
                        "event" to "connection_ended",
                        "detail" to mapOf("reason" to (body.reason ?: "user_hangup"), "by" to "device"),
                    ),
                )
            }
        }
    }

    override suspend fun iceServers(connectionId: String): IceServersDto {
        val response = functions.authorize(SupabaseAuthorizeRequest(connectionId = connectionId))
        lastSignaling = response.signaling
        return IceServersDto(iceServers = response.iceServers, ttl = response.ttl)
    }
}

class SupabaseDeviceApi(
    private val functions: SupabaseFunctionsApi,
    private val rest: SupabaseRestApi,
) : DeviceApi {
    override suspend fun reportStatus(deviceId: String, body: DeviceStatusRequestDto): DeviceEnvelopeDto {
        // Straight PostgREST update under row level security: the owner may touch their own device,
        // so telemetry does not depend on a separately deployed Edge Function.
        val patch = buildMap<String, Any?> {
            put("telemetry", body.telemetry)
            put("online", true)
            put("last_seen_at", java.time.Instant.now().toString())
            body.name?.let { put("name", it) }
        }
        val rows = rest.patchDevice(deviceId, patch)
        val row = rows.firstOrNull() ?: throw IOException("The device status report was rejected")
        return DeviceEnvelopeDto(device = row.toDto())
    }
}

/** Holder so Hilt can build the three adapters once. */
class SupabaseApis(
    val publicApi: SupabasePublicApi,
    val ownerApi: SupabaseOwnerApi,
    val deviceApi: SupabaseDeviceApi,
)
