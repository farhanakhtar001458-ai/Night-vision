package com.droidlinkx.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.droidlinkx.core.designsystem.component.DroidCard
import com.droidlinkx.core.designsystem.theme.DroidLinkColors

@Composable
fun AuthRoute(viewModel: AuthViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    AuthScreen(
        state = state,
        onLogin = viewModel::login,
        onRegister = viewModel::register,
        onClearMessages = viewModel::clearMessages,
    )
}

@Composable
fun AuthScreen(
    state: AuthUiState,
    onLogin: (String, String) -> Unit,
    onRegister: (String, String, String) -> Unit,
    onClearMessages: () -> Unit,
) {
    var mode by remember { mutableStateOf(0) }
    var displayName by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("DroidLink X", style = MaterialTheme.typography.displaySmall, color = DroidLinkColors.BrandBright)
        Spacer(Modifier.height(6.dp))
        Text(
            "Sign in with your owner account. This device enrolls itself automatically — no QR code required.",
            style = MaterialTheme.typography.bodyMedium,
            color = DroidLinkColors.TextSecondary,
        )
        Spacer(Modifier.height(22.dp))

        TabRow(selectedTabIndex = mode) {
            Tab(selected = mode == 0, onClick = { mode = 0; onClearMessages() }, text = { Text("Sign in") })
            Tab(selected = mode == 1, onClick = { mode = 1; onClearMessages() }, text = { Text("Create account") })
        }
        Spacer(Modifier.height(18.dp))

        DroidCard {
            if (mode == 1) {
                OutlinedTextField(
                    value = displayName,
                    onValueChange = { displayName = it },
                    label = { Text("Display name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))
            }
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text(if (mode == 1) "Password (10+ characters)" else "Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(14.dp))
            state.error?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = DroidLinkColors.Danger)
                Spacer(Modifier.height(8.dp))
            }
            state.info?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = DroidLinkColors.BrandBright)
                Spacer(Modifier.height(8.dp))
            }

            Button(
                onClick = {
                    if (mode == 0) onLogin(email, password) else onRegister(email, password, displayName)
                },
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (state.busy) {
                    CircularProgressIndicator(modifier = Modifier.height(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.height(0.dp))
                } else {
                    Text(if (mode == 0) "Sign in and enroll this device" else "Create owner account")
                }
            }
            Spacer(Modifier.height(6.dp))
            TextButton(onClick = onClearMessages, modifier = Modifier.align(Alignment.End)) {
                Text("Clear")
            }
        }

        Spacer(Modifier.height(18.dp))
        Text(
            "Passwords are hashed with scrypt on the server. Device credentials are stored in the Android Keystore and never leave this device in plain text.",
            style = MaterialTheme.typography.labelSmall,
            color = DroidLinkColors.TextSecondary,
        )
    }
}
