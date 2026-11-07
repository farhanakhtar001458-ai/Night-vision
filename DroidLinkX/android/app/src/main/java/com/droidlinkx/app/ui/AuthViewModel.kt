package com.droidlinkx.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.droidlinkx.core.domain.model.Outcome
import com.droidlinkx.core.domain.model.OwnerSession
import com.droidlinkx.core.domain.repository.DeviceRegistrationRepository
import com.droidlinkx.core.domain.repository.OwnerAuthRepository
import com.droidlinkx.core.domain.repository.StartupCoordinator
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AuthUiState(
    val session: OwnerSession? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val info: String? = null,
)

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val ownerAuth: OwnerAuthRepository,
    private val deviceRegistration: DeviceRegistrationRepository,
    private val startupCoordinator: StartupCoordinator,
) : ViewModel() {

    private val busy = MutableStateFlow(false)
    private val error = MutableStateFlow<String?>(null)
    private val info = MutableStateFlow<String?>(null)

    val state: StateFlow<AuthUiState> = combine(
        ownerAuth.observeSession(),
        busy,
        error,
        info,
    ) { session, isBusy, err, message ->
        AuthUiState(session = session, busy = isBusy, error = err, info = message)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AuthUiState())

    fun login(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) {
            error.value = "Enter your email and password"
            return
        }
        viewModelScope.launch {
            busy.value = true
            error.value = null
            when (val result = ownerAuth.login(email, password)) {
                is Outcome.Success -> completeEnrollment()
                is Outcome.Failure -> error.value = result.message
            }
            busy.value = false
        }
    }

    fun register(email: String, password: String, displayName: String) {
        if (email.isBlank() || password.length < 10 || displayName.length < 2) {
            error.value = "Use a display name of 2+ characters and a password of at least 10 characters."
            return
        }
        viewModelScope.launch {
            busy.value = true
            error.value = null
            when (val result = ownerAuth.register(email, password, displayName)) {
                is Outcome.Success -> completeEnrollment()
                is Outcome.Failure -> {
                    // "Create account" on an email that already exists should just sign the owner in;
                    // asking someone to retype credentials they already entered is busywork.
                    if (result.code == "user_already_exists" || result.code == "email_exists") {
                        info.value = "This email is already registered — signing you in…"
                        when (val login = ownerAuth.login(email, password)) {
                            is Outcome.Success -> completeEnrollment()
                            is Outcome.Failure -> {
                                info.value = null
                                error.value = "This email already has an account. Use the Sign in tab " +
                                    "(or reset the password). ${login.message}"
                            }
                        }
                    } else {
                        error.value = result.message
                    }
                }
            }
            busy.value = false
        }
    }

    private suspend fun completeEnrollment() {
        info.value = "Owner account ready — registering this device…"
        when (val result = deviceRegistration.registerCurrentDevice()) {
            is Outcome.Success -> {
                info.value = null
                startupCoordinator.initialize()
            }
            is Outcome.Failure -> error.value = result.message
        }
    }

    fun clearMessages() {
        error.value = null
        info.value = null
    }
}
