plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

android {
    namespace = "com.droidlinkx.core.network"
    compileSdk = 36
    defaultConfig {
        minSdk = 26
        buildConfigField("String", "API_BASE_URL", "\"https://api.droidlinkx.local/\"")
        // Supplied from gradle.properties / local.properties / environment at build time.
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

fun gradleProperty(name: String, envName: String): String =
    (project.findProperty(name) as String?)?.takeIf { it.isNotBlank() }
        ?: System.getenv(envName)?.takeIf { it.isNotBlank() }
        ?: ""

fun supabaseUrl(): String = gradleProperty("droidlinkx.supabase.url", "SUPABASE_URL")
fun supabaseAnonKey(): String = gradleProperty("droidlinkx.supabase.anonKey", "SUPABASE_ANON_KEY")
fun signalingUrl(): String = gradleProperty("droidlinkx.signaling.url", "SIGNALING_URL")

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
