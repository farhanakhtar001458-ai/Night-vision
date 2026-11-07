package com.droidlinkx.core.data.repository

import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.domain.model.OwnerProfile
import com.droidlinkx.core.domain.model.OwnerSession
import com.droidlinkx.core.domain.model.OwnerTokens
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.toFailure
import com.droidlinkx.core.domain.repository.OwnerAuthRepository
import com.droidlinkx.core.network.api.OwnerApi
import com.droidlinkx.core.network.api.PublicApi
import com.droidlinkx.core.network.dto.AuthResponseDto
import com.droidlinkx.core.network.dto.LoginRequestDto
import com.droidlinkx.core.network.dto.LogoutRequestDto
import com.droidlinkx.core.network.dto.RefreshRequestDto
import com.droidlinkx.core.network.dto.RegisterRequestDto
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class OwnerAuthRepositoryImpl @Inject constructor(
    private val publicApi: PublicApi,
    private val ownerApi: OwnerApi,
    private val sessionStorage: SessionStorage,
) : OwnerAuthRepository {

    private val sessionState = MutableStateFlow(sessionStorage.ownerSession())
    private val refreshMutex = Mutex()

    override fun observeSession(): Flow<OwnerSession?> = sessionState.asStateFlow()

    override suspend fun register(email: String, password: String, displayName: String): Outcome<OwnerSession> =
        runCatchingOutcome {
            val response = publicApi.register(
                RegisterRequestDto(
                    email = email.trim().lowercase(),
                    password = password,
                    displayName = displayName.trim(),
                ),
            )
            store(response)
        }

    override suspend fun login(email: String, password: String): Outcome<OwnerSession> = runCatchingOutcome {
        val response = publicApi.login(LoginRequestDto(email.trim().lowercase(), password))
        store(response)
    }

    override suspend fun restoreSession(): Outcome<OwnerSession?> {
        val stored = sessionStorage.ownerSession() ?: return Outcome.Success(null)
        sessionState.value = stored
        if (stored.tokens.accessExpiresAtEpochMillis - System.currentTimeMillis() > FRESH_WINDOW_MILLIS) {
            return Outcome.Success(stored)
        }
        return when (val refreshed = refreshSession()) {
            is Outcome.Success -> Outcome.Success(refreshed.value)
            is Outcome.Failure -> {
                if (refreshed.httpStatus == 401) {
                    sessionStorage.clearOwnerSession()
                    sessionState.value = null
                    Outcome.Success(null)
                } else {
                    // Network hiccup: keep the cached session and retry later.
                    Outcome.Success(stored)
                }
            }
        }
    }

    override suspend fun refreshSession(): Outcome<OwnerSession> = refreshMutex.withLock {
        val stored = sessionStorage.ownerSession()
            ?: return@withLock Outcome.Failure("No stored session to refresh", code = "NO_SESSION")
        runCatchingOutcome {
            val response = publicApi.refresh(RefreshRequestDto(stored.tokens.refreshToken))
            store(response)
        }
    }

    override suspend fun <T> authorized(block: suspend () -> T): Outcome<T> {
        return when (val first = runCatchingOutcome(block)) {
            is Outcome.Success -> first
            is Outcome.Failure -> {
                if (first.httpStatus != 401) return first
                DroidLog.i(message = "Owner token rejected, attempting refresh")
                when (val refreshed = refreshSession()) {
                    is Outcome.Failure -> refreshed
                    is Outcome.Success -> {
                        if (refreshed.value.tokens.accessToken.isBlank()) {
                            Outcome.Failure("Authentication required", code = "UNAUTHORIZED", httpStatus = 401)
                        } else {
                            runCatchingOutcome(block)
                        }
                    }
                }
            }
        }
    }

    override suspend fun logout() {
        val stored = sessionStorage.ownerSession()
        runCatching {
            if (stored != null) ownerApi.logout(LogoutRequestDto(stored.tokens.refreshToken))
        }.onFailure { DroidLog.w(message = "Logout call failed; clearing locally anyway", throwable = it) }
        sessionStorage.clearOwnerSession()
        sessionState.value = null
    }

    private fun store(response: AuthResponseDto): OwnerSession {
        val session = OwnerSession(
            profile = OwnerProfile(
                id = response.user.id,
                email = response.user.email,
                displayName = response.user.displayName,
            ),
            tokens = OwnerTokens(
                accessToken = response.tokens.accessToken,
                refreshToken = response.tokens.refreshToken,
                accessExpiresAtEpochMillis = System.currentTimeMillis() + response.tokens.expiresIn * 1_000,
            ),
        )
        sessionStorage.saveOwnerSession(session)
        sessionState.value = session
        return session
    }

    private suspend fun <T> runCatchingOutcome(block: suspend () -> T): Outcome<T> = try {
        Outcome.Success(block())
    } catch (http: HttpException) {
        http.readableFailure()
    } catch (io: IOException) {
        Outcome.Failure(
            message = "Cannot reach the DroidLink X server. Check the server URL and your connection.",
            code = "NETWORK",
            cause = io,
        )
    } catch (t: Throwable) {
        t.toFailure("Unexpected failure")
    }

    /**
     * GoTrue reports a machine-readable `error_code` next to the human message. Those codes are what
     * make sign-in failures actionable ("already registered", "confirmation required", "rate
     * limited") instead of a generic "server error".
     */
    private fun HttpException.readableFailure(): Outcome.Failure {
        val raw = runCatching { response()?.errorBody()?.string() }.getOrNull().orEmpty()
        val body = runCatching { JSONObject(raw) }.getOrNull()
        val errorCode = body?.optString("error_code").orEmpty()
            .ifBlank { body?.optString("code").orEmpty() }
            .ifBlank { body?.optString("error").orEmpty() }
        val serverMessage = body?.optString("msg").orEmpty()
            .ifBlank { body?.optString("message").orEmpty() }
            .ifBlank { body?.optString("error_description").orEmpty() }

        val message = when {
            errorCode in setOf("user_already_exists", "email_exists") ->
                "This email is already registered — signing you in instead."
            errorCode in setOf("over_email_send_rate_limit", "over_request_rate_limit", "over_sms_send_rate_limit") ->
                "Too many attempts in a short time. Wait a minute and try again — or switch to Sign in, the account may already exist."
            errorCode == "email_not_confirmed" -> "Confirm your email address, then sign in."
            errorCode == "invalid_credentials" -> "Invalid email or password."
            errorCode == "weak_password" -> "Choose a stronger password (at least 10 characters)."
            errorCode == "signup_disabled" -> "New sign-ups are disabled for this project."
            serverMessage.isNotBlank() -> serverMessage
            code() == 401 -> "Invalid email or password."
            code() == 409 -> "An account with this email already exists."
            code() == 429 -> "Too many attempts. Wait a minute and try again."
            code() in 500..599 -> "The backend is not responding right now (HTTP ${code()})."
            else -> "Request failed (HTTP ${code()})."
        }

        return Outcome.Failure(
            message = message,
            code = errorCode.ifBlank { "HTTP_${code()}" },
            httpStatus = code(),
            cause = this,
        )
    }

    companion object {
        private const val FRESH_WINDOW_MILLIS = 5 * 60 * 1_000L
    }
}
