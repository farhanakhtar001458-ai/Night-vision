package com.droidlinkx.core.security

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.droidlinkx.core.common.DroidLog
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class EncryptedCredentialVault @Inject constructor(
    @ApplicationContext context: Context,
    private val crypto: KeystoreCrypto,
) : CredentialVault {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    override fun put(key: String, value: String) {
        val encrypted = crypto.encrypt(value)
        prefs.edit(commit = true) { putString(key, encrypted) }
    }

    override fun get(key: String): String? {
        val encrypted = prefs.getString(key, null) ?: return null
        return crypto.decrypt(encrypted)
    }

    override fun remove(key: String) {
        prefs.edit(commit = true) { remove(key) }
    }

    override fun clear() {
        prefs.edit(commit = true) { clear() }
        DroidLog.i(message = "Credential vault cleared")
    }

    override val keys: Set<String> get() = prefs.all.keys

    companion object {
        private const val PREFERENCES_NAME = "droidlinkx.secure.v1"
    }
}
