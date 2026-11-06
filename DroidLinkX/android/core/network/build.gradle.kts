plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

/*
 * IMPORTANT: these values and helpers must stay *above* the `android { }` block. A property that is
 * declared after it is still `null` while `defaultConfig` runs, and `buildConfigField` then bakes the
 * literal string "null" into the APK — which is exactly the crash this ordering caused
 * ("Expected URL scheme 'http' or 'https' but no scheme was found for null/").
 */

// Public project coordinates. The anon key is designed to be shipped inside clients: Row Level
// Security decides what a caller may read or write. The service_role key never appears here.
val defaultSupabaseUrl = "https://zarxnrkzdwnjiauybghl.supabase.co"
val defaultSupabaseAnonKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inphcnhucmt6ZHduamlhdXliZ2hsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NzQ1OTUsImV4cCI6MjEwODM1MDU5NX0.dcdHLqwF75YfEOTT2H9Vw-MN0Sr1UzIOzoGYTaB7r2s"

fun gradleProperty(name: String, envName: String): String =
    (project.findProperty(name) as String?)?.takeIf { it.isNotBlank() && it != "null" }
        ?: System.getenv(envName)?.takeIf { it.isNotBlank() && it != "null" }
        ?: ""

fun supabaseUrl(): String = gradleProperty("droidlinkx.supabase.url", "SUPABASE_URL").ifBlank { defaultSupabaseUrl }
fun supabaseAnonKey(): String = gradleProperty("droidlinkx.supabase.anonKey", "SUPABASE_ANON_KEY").ifBlank { defaultSupabaseAnonKey }
fun signalingUrl(): String = gradleProperty("droidlinkx.signaling.url", "SIGNALING_URL")

android {
    namespace = "com.droidlinkx.core.network"
    compileSdk = 36
    defaultConfig {
        minSdk = 26
        buildConfigField("String", "API_BASE_URL", "\"https://api.droidlinkx.local/\"")
        // Supplied from gradle.properties / environment at build time, with the project defaults above.
        buildConfigField("String", "SUPABASE_URL", "\"${supabaseUrl()}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${supabaseAnonKey()}\"")
        buildConfigField("String", "SIGNALING_URL", "\"${signalingUrl()}\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin { jvmToolchain(17) }
}

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:domain"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.retrofit)
    implementation(libs.retrofit.moshi)
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.moshi)
    implementation(libs.moshi.kotlin)
    ksp(libs.moshi.codegen)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
