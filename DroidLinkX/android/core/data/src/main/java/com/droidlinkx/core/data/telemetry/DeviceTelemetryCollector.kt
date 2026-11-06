package com.droidlinkx.core.data.telemetry

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Point
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.os.SystemClock
import android.view.WindowManager
import com.droidlinkx.core.domain.model.DeviceTelemetry
import dagger.hilt.android.qualifiers.ApplicationContext
import java.net.Inet4Address
import java.net.NetworkInterface
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Reads live device state with official Android APIs only. Unavailable values stay null so the UI can
 * distinguish "not reported" from a real zero.
 */
@Singleton
class DeviceTelemetryCollector @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    fun collect(): DeviceTelemetry {
        val battery = readBattery()
        val storage = readStorage()
        val memory = readMemory()
        val window = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        // WindowMetrics is API 30+; older devices fall back to the deprecated display size below.
        val bounds = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window?.currentWindowMetrics?.bounds else null
        val resolution = if (bounds != null) "${bounds.width()}x${bounds.height()}" else legacyResolution(window)

        return DeviceTelemetry(
            battery = battery.level,
            charging = battery.charging,
            network = readNetworkType(),
            ip = readLocalIpAddress(),
            storageFreeBytes = storage.first,
            storageTotalBytes = storage.second,
            ramUsedBytes = memory.first,
            ramTotalBytes = memory.second,
            cpu = readCpu(),
            screenResolution = resolution,
            uptimeSeconds = SystemClock.elapsedRealtime() / 1_000,
            batteryTemperatureC = battery.temperatureC,
        )
    }

    private data class BatteryState(val level: Int?, val charging: Boolean?, val temperatureC: Double?)

    private fun readBattery(): BatteryState {
        val manager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val level = manager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 }
        val sticky = runCatching {
            context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        }.getOrNull()
        val status = sticky?.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = when (status) {
            BatteryManager.BATTERY_STATUS_CHARGING, BatteryManager.BATTERY_STATUS_FULL -> true
            BatteryManager.BATTERY_STATUS_DISCHARGING, BatteryManager.BATTERY_STATUS_NOT_CHARGING -> false
            else -> null
        }
        val temperature = sticky?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
            ?.takeIf { it != Int.MIN_VALUE }
            ?.let { it / 10.0 }
        return BatteryState(level, charging, temperature)
    }

    private fun readStorage(): Pair<Long?, Long?> = runCatching {
        val stat = StatFs(Environment.getDataDirectory().absolutePath)
        stat.availableBytes to stat.totalBytes
    }.getOrDefault(null to null)

    private fun readMemory(): Pair<Long?, Long?> {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return null to null
        val info = ActivityManager.MemoryInfo()
        manager.getMemoryInfo(info)
        val used = info.totalMem - info.availMem
        return used to info.totalMem
    }

    private fun readNetworkType(): String? {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return "offline"
        return when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> "bluetooth"
            else -> "other"
        }
    }

    private fun readLocalIpAddress(): String? = runCatching {
        NetworkInterface.getNetworkInterfaces().toList()
            .asSequence()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList().asSequence() }
            .filterIsInstance<Inet4Address>()
            .firstOrNull { !it.isLoopbackAddress }
            ?.hostAddress
    }.getOrNull()

    private fun readCpu(): String? = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> Build.SOC_MODEL?.takeIf { it.isNotBlank() }
        else -> null
    } ?: Build.HARDWARE?.takeIf { it.isNotBlank() }

    @Suppress("DEPRECATION")
    private fun legacyResolution(window: WindowManager?): String? = runCatching {
        val point = Point()
        window?.defaultDisplay?.getRealSize(point)
        if (point.x > 0) "${point.x}x${point.y}" else null
    }.getOrNull()

    fun isIgnoringBatteryOptimizations(): Boolean {
        val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return power.isIgnoringBatteryOptimizations(context.packageName)
    }
}
