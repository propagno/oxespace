package com.oxespace.mobile.approval

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import com.oxespace.mobile.R
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** What the person is about to do from the phone; each has its own words in the prompt. */
enum class PresenceReason { SEND, TYPE }

enum class Presence {
    CONFIRMED,
    /** The prompt was cancelled or failed. */
    NOT_CONFIRMED,
    /** The phone has no screen lock, so nobody can prove it's them on it. */
    NO_SCREEN_LOCK,
}

/** Whether the person holding the phone proved it's them recently enough to send from it. */
fun interface PresenceCheck {
    suspend fun confirm(reason: PresenceReason): Presence
}

/** Sending, steering or typing into a terminal, once the person is confirmed; or why nothing went out. */
sealed interface Gated<out T> {
    data class Done<T>(val value: T) : Gated<T>
    data class Blocked(val reason: Presence) : Gated<Nothing>
}

/** Messages and terminal input leave the phone only through here (MB-M-01). Stopping a turn needs no confirmation. */
class PresenceGate(private val check: PresenceCheck) {
    /** Asks without acting: a terminal the phone can type into asks when it opens. */
    suspend fun confirm(reason: PresenceReason): Presence = check.confirm(reason)

    suspend fun <T> run(reason: PresenceReason, action: suspend () -> T): Gated<T> {
        val presence = check.confirm(reason)
        return if (presence == Presence.CONFIRMED) Gated.Done(action()) else Gated.Blocked(presence)
    }
}

/**
 * The window is the Keystore's, not a clock in the app: a key that works only within [WINDOW_SECONDS] of the person
 * unlocking with strong biometrics or the device credential. While it works nothing is asked; once it doesn't, the
 * system prompt asks, and a success opens the window again. Without a screen lock the key can't exist, and nothing
 * is sent.
 */
class KeystorePresence(private val context: Context) : PresenceCheck {
    override suspend fun confirm(reason: PresenceReason): Presence {
        if (usable() ?: return Presence.NO_SCREEN_LOCK) return Presence.CONFIRMED
        val title = context.getString(if (reason == PresenceReason.SEND) R.string.presence_send else R.string.presence_type)
        if (!systemPrompt(context, title, null, context.getString(R.string.presence_window))) return Presence.NOT_CONFIRMED
        return if (usable() == true) Presence.CONFIRMED else Presence.NOT_CONFIRMED
    }

    /** True inside the window, false outside it, null when the key can't be made (no screen lock). */
    private fun usable(): Boolean? {
        val key = try {
            key()
        } catch (_: GeneralSecurityException) {
            return null
        } catch (_: IllegalStateException) {
            return null
        }
        return try {
            Cipher.getInstance("AES/GCM/NoPadding").init(Cipher.ENCRYPT_MODE, key)
            true
        } catch (_: UserNotAuthenticatedException) {
            false
        } catch (_: KeyPermanentlyInvalidatedException) {
            // The screen lock changed: make a new key; the next unlock opens its window.
            keyStore().deleteEntry(ALIAS)
            false
        }
    }

    private fun keyStore() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun key(): SecretKey {
        (keyStore().getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    setUserAuthenticationParameters(WINDOW_SECONDS, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                } else {
                    @Suppress("DEPRECATION") setUserAuthenticationValidityDurationSeconds(WINDOW_SECONDS)
                }
            }
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
            init(spec)
            generateKey()
        }
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "oxespace.presence"
        /** Matches "Good for 5 minutes" in the prompt. */
        const val WINDOW_SECONDS = 300
    }
}
