package com.droidlinkx.core.data.repository

import com.droidlinkx.core.common.DroidLog
import com.droidlinkx.core.domain.model.OwnerProfile
import com.droidlinkx.core.domain.model.OwnerSession
import com.droidlinkx.core.domain.model.OwnerTokens
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.toFailure
import com.droidlinkx.core.domain.repository.OwnerAuthRepository
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
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class OwnerAuthRepositoryImpl @Inject constructor(
    private val publicApi: PublicApi,
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
            if (stored != null) publicApi.logout(LogoutRequestDto(stored.tokens.refreshToken))
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
        Outcome.Failure(
            message = http.readableMessage(),
            code = "HTTP_${http.code()}",
            httpStatus = http.code(),
            cause = http,
        )
    } catch (io: IOException) {
        Outcome.Failure(
            message = "Cannot reach the DroidLink X server. Check the server URL and your connection.",
            code = "NETWORK",
            cause = io,
        )
    } catch (t: Throwable) {
        t.toFailure("Unexpected failure")
    }

    private fun HttpException.readableMessage(): String = when (code()) {
        401 -> "Invalid email or password."
        409 -> "An account with this email already exists."
        422 -> "Please check the values you entered."
        429 -> "Too many attempts. Please wait and try again."
        else -> "Server error (HTTP ${code()})."
    }

    companion object {
        private const val FRESH_WINDOW_MILLIS = 5 * 60 * 1_000L
    }
}
