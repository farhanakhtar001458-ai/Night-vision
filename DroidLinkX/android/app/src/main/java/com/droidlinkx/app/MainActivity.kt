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
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.droidlinkx.app.crash.CrashGuard
import com.droidlinkx.app.crash.CrashScreen
import com.droidlinkx.app.ui.AuthRoute
import com.droidlinkx.app.ui.AuthViewModel
import com.droidlinkx.core.designsystem.theme.DroidLinkColors
import com.droidlinkx.core.designsystem.theme.DroidLinkTheme
import com.droidlinkx.feature.dashboard.DashboardRoute
import com.droidlinkx.feature.devices.DevicesRoute
import com.droidlinkx.feature.settings.SettingsRoute
import com.droidlinkx.feature.tools.ToolsRoute
import com.droidlinkx.feature.transfers.TransfersRoute
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* the service still works without it */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CrashGuard.install(this)
        runCatching { requestNotificationPermissionIfNeeded() }
        setContent {
            DroidLinkTheme {
                CrashGate()
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

/**
 * Renders the crash report left by the previous launch, or the app itself. Nothing else runs until
 * the report is dismissed, so a crash never turns into an unreadable crash loop.
 */
@Composable
private fun CrashGate() {
    val context = LocalContext.current
    val report = remember { CrashGuard.lastReport(context) }
    var dismissed by remember { mutableStateOf(false) }

    if (report != null && !dismissed) {
        CrashScreen(
            report = report,
            onCopy = { CrashGuard.copyToClipboard(context, report) },
            onDismiss = {
                CrashGuard.clear(context)
                dismissed = true
            },
        )
        return
    }

    DroidLinkApp()
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
            composable(Tab.Transfer.route) { TransfersRoute() }
            composable(Tab.Tools.route) { ToolsRoute() }
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
