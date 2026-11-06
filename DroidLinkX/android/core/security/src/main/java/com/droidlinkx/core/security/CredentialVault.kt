package com.droidlinkx.core.security

/**
 * Encrypted key/value storage for device credentials and owner tokens.
 * Backed by SharedPreferences + an AES-256-GCM key that never leaves the Android Keystore.
 */
interface CredentialVault {
    fun put(key: String, value: String)
    fun get(key: String): String?
    fun remove(key: String)
    fun clear()
    val keys: Set<String>
}

class MemoryCredentialVault : CredentialVault {
    private val map = mutableMapOf<String, String>()
    override fun put(key: String, value: String) {
        map[key] = value
    }
    override fun get(key: String): String? = map[key]
    override fun remove(key: String) {
        map.remove(key)
    }
    override fun clear() = map.clear()
    override val keys: Set<String> get() = map.keys.toSet()
}
