package com.droidlinkx.core.data.util

import com.droidlinkx.core.domain.model.Outcome
import retrofit2.HttpException
import java.io.IOException

/** Maps transport failures onto the repository result type used by every feature. */
suspend fun <T> outcomeOf(block: suspend () -> T): Outcome<T> = try {
    Outcome.Success(block())
} catch (http: HttpException) {
    Outcome.Failure(messageFor(http), code = "HTTP_${http.code()}", httpStatus = http.code(), cause = http)
} catch (io: IOException) {
    Outcome.Failure(io.message ?: "The network request failed", code = "NETWORK", cause = io)
} catch (t: Throwable) {
    Outcome.Failure(t.message ?: "The request failed", code = "REPOSITORY", cause = t)
}

private fun messageFor(http: HttpException): String = when (http.code()) {
    401 -> "Your session expired. Sign in again."
    403 -> "This action is not allowed for your account."
    404 -> "The requested item no longer exists."
    409 -> "The server rejected this request."
    else -> "The server returned HTTP ${http.code()}."
}
