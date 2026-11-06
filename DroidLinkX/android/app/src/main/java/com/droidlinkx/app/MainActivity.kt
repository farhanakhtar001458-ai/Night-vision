package com.droidlinkx.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.droidlinkx.app.ui.AuthRoute
import com.droidlinkx.app.ui.AuthViewModel
import com.droidlinkx.core.designsystem.component.DroidCard
import com.droidlinkx.core.designsystem.component.ScreenHeader
import com.droidlinkx.core.designsystem.component.SectionLabel
import com.droidlinkx.core.designsystem.theme.DroidLinkColors
import com.droidlinkx.core.designsystem.theme.DroidLinkTheme
import com.droidlinkx.feature.dashboard.DashboardRoute
import com.droidlinkx.feature.devices.DevicesRoute
import com.droidlinkx.feature.settings.SettingsRoute
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* the service still works without it */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermissionIfNeeded()
        setContent {
            DroidLinkTheme {
                DroidLinkApp()
            }
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}

private sealed class Tab(val route: String, val label: String) {
    data object Home : Tab("home", "Home")
    data object Devices : Tab("devices", "Devices")
    data object Transfer : Tab("transfer", "Transfer")
    data object Tools : Tab("tools", "Tools")
    data object Profile : Tab("profile", "Profile")

    companion object {
        val all = listOf(Home, Devices, Transfer, Tools, Profile)
    }
}

@Composable
fun DroidLinkApp(authViewModel: AuthViewModel = hiltViewModel()) {
    val authState by authViewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val signedIn = authState.session != null

    if (!signedIn) {
        AuthRoute(viewModel = authViewModel)
        return
    }

    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                Tab.all.forEach { tab ->
                    val selected = backStackEntry?.destination?.hierarchy?.any { it.route == tab.route } == true ||
                        (currentRoute == null && tab == Tab.Home)
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(tab.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = {
                            Icon(
                                imageVector = when (tab) {
                                    Tab.Home -> Icons.Filled.Home
                                    Tab.Devices -> Icons.Filled.Devices
                                    Tab.Transfer -> Icons.Filled.SwapHoriz
                                    Tab.Tools -> Icons.Filled.Build
                                    Tab.Profile -> Icons.Filled.Person
                                },
                                contentDescription = tab.label,
                            )
                        },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Tab.Home.route,
            modifier = Modifier.padding(padding),
        ) {
            composable(Tab.Home.route) {
                DashboardRoute(
                    onOpenDevices = { navController.navigate(Tab.Devices.route) },
                    onOpenSettings = { navController.navigate(Tab.Profile.route) },
                )
            }
            composable(Tab.Devices.route) { DevicesRoute() }
            composable(Tab.Transfer.route) { PhasePlaceholder("Transfers", "Chunked, resumable transfers with checksum verification arrive in the next development phase. The backend endpoints, progress events and dashboard are already live.") }
            composable(Tab.Tools.route) { PhasePlaceholder("Tools", "File manager, screen mirroring, remote camera, notification and clipboard tools are being delivered phase by phase. Nothing here is a mock: unfinished tools are not exposed.") }
            composable(Tab.Profile.route) {
                SettingsRoute(
                    onOpenBatterySettings = {
                        val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        runCatching { context.startActivity(intent) }
                    },
                    onSignedOut = { navController.navigate(Tab.Home.route) { popUpTo(0) } },
                )
            }
        }
    }
}

@Composable
private fun PhasePlaceholder(title: String, detail: String) {
    Column(Modifier.fillMaxSize().padding(18.dp)) {
        Spacer(Modifier.height(12.dp))
        ScreenHeader(title = title, subtitle = "Delivered in phases — no placeholder controls are shipped.")
        Spacer(Modifier.height(16.dp))
        DroidCard {
            SectionLabel("Status")
            Spacer(Modifier.height(8.dp))
            Text(detail, color = DroidLinkColors.TextSecondary)
        }
    }
}
