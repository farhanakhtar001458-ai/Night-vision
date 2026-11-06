package com.droidlinkx.core.domain.model

/** Result type used across repositories so feature modules never touch transport exceptions. */
sealed interface Outcome<out T> {
    data class Success<T>(val value: T) : Outcome<T>
    data class Failure(
        val message: String,
        val code: String? = null,
        val httpStatus: Int? = null,
        val cause: Throwable? = null,
    ) : Outcome<Nothing>
}

inline fun <T, R> Outcome<T>.map(transform: (T) -> R): Outcome<R> = when (this) {
    is Outcome.Success -> Outcome.Success(transform(value))
    is Outcome.Failure -> this
}

inline fun <T> Outcome<T>.onSuccess(block: (T) -> Unit): Outcome<T> {
    if (this is Outcome.Success) block(value)
    return this
}

inline fun <T> Outcome<T>.onFailure(block: (Outcome.Failure) -> Unit): Outcome<T> {
    if (this is Outcome.Failure) block(this)
    return this
}

fun <T> Outcome<T>.getOrNull(): T? = (this as? Outcome.Success)?.value

fun Throwable.toFailure(defaultMessage: String): Outcome.Failure =
    Outcome.Failure(message = message ?: defaultMessage, cause = this)
