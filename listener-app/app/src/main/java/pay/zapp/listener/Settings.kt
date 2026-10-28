package pay.zapp.listener

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Where to send, who this phone is, and its signing key. The key is
 * encrypted with a key that never leaves the phone's hardware keystore, so a
 * copy of the app's files alone can't sign anything.
 */
class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("listener", Context.MODE_PRIVATE)

    var endpoint: String
        get() = prefs.getString("endpoint", null) ?: Protocol.DEFAULT_ENDPOINT
        set(v) = prefs.edit().putString("endpoint", v.trim()).apply()

    var deviceId: String
        get() = prefs.getString("deviceId", "") ?: ""
        set(v) = prefs.edit().putString("deviceId", v.trim()).apply()

    var senderIds: List<String>
        get() = Protocol.parseSenderIds(prefs.getString("senderIds", "") ?: "")
        set(v) = prefs.edit().putString("senderIds", v.joinToString(", ")).apply()

    /** Forward every text, not just the operator's: only for collecting samples. */
    var forwardAll: Boolean
        get() = prefs.getBoolean("forwardAll", false)
        set(v) = prefs.edit().putBoolean("forwardAll", v).apply()

    var lastResult: String
        get() = prefs.getString("lastResult", "") ?: ""
        set(v) = prefs.edit().putString("lastResult", v).apply()

    var lastHeartbeatOkMs: Long
        get() = prefs.getLong("lastHeartbeatOkMs", 0)
        set(v) = prefs.edit().putLong("lastHeartbeatOkMs", v).apply()

    val isConfigured: Boolean
        get() = deviceId.startsWith("ld_") && key() != null

    fun saveKey(key: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, vaultKey())
        val sealed = cipher.doFinal(key.trim().toByteArray(Charsets.UTF_8))
        prefs.edit()
            .putString("keyIv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("keySealed", Base64.encodeToString(sealed, Base64.NO_WRAP))
            .apply()
    }

    fun key(): String? {
        val iv = prefs.getString("keyIv", null) ?: return null
        val sealed = prefs.getString("keySealed", null) ?: return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, vaultKey(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(sealed, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }

    private fun vaultKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return gen.generateKey()
    }

    private companion object {
        const val ALIAS = "zapp-listener-vault"
    }
}
