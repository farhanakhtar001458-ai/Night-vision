package com.droidlinkx.core.designsystem.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object DroidLinkColors {
    val Ink = Color(0xFF05070D)
    val Surface = Color(0xFF0B0F1A)
    val SurfaceElevated = Color(0xFF111726)
    val Outline = Color(0x1AFFFFFF)
    val Brand = Color(0xFF16AD90)
    val BrandBright = Color(0xFF6FDFC5)
    val Accent = Color(0xFF5B6EF5)
    val Warning = Color(0xFFF0B866)
    val Danger = Color(0xFFF46D7D)
    val TextPrimary = Color(0xFFE8EDF6)
    val TextSecondary = Color(0xFF96A1B6)
}

private val DarkScheme = darkColorScheme(
    primary = DroidLinkColors.BrandBright,
    onPrimary = DroidLinkColors.Ink,
    secondary = DroidLinkColors.Accent,
    onSecondary = Color.White,
    tertiary = DroidLinkColors.Warning,
    background = DroidLinkColors.Ink,
    onBackground = DroidLinkColors.TextPrimary,
    surface = DroidLinkColors.Surface,
    onSurface = DroidLinkColors.TextPrimary,
    surfaceVariant = DroidLinkColors.SurfaceElevated,
    onSurfaceVariant = DroidLinkColors.TextSecondary,
    outline = DroidLinkColors.Outline,
    error = DroidLinkColors.Danger,
)

private val LightScheme = lightColorScheme(
    primary = Color(0xFF0B8A75),
    onPrimary = Color.White,
    secondary = Color(0xFF4652E0),
    background = Color(0xFFF6F8FB),
    surface = Color.White,
    onSurface = Color(0xFF101828),
)

private val DroidTypography = Typography(
    displaySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 32.sp, lineHeight = 38.sp),
    headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 24.sp, lineHeight = 30.sp),
    titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 26.sp),
    titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium, fontSize = 16.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 13.sp, lineHeight = 19.sp),
    labelMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium, fontSize = 12.sp, letterSpacing = 0.4.sp),
    labelSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium, fontSize = 10.sp, letterSpacing = 0.8.sp),
)

@Composable
fun DroidLinkTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkScheme else LightScheme,
        typography = DroidTypography,
        content = content,
    )
}
