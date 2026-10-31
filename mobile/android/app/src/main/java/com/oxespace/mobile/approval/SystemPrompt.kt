package com.oxespace.mobile.approval

import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import com.oxespace.mobile.R
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * The system's own prompt: strong biometrics or the device's PIN, pattern or password. With neither set up, or when
 * the person cancels, it answers false. The framework prompt (API 28+) needs no extra library.
 */
suspend fun systemPrompt(context: Context, title: String, subtitle: String?, description: String?): Boolean =
    suspendCancellableCoroutine { continuation ->
        val executor = ContextCompat.getMainExecutor(context)
        val builder = BiometricPrompt.Builder(context).setTitle(title)
        subtitle?.let(builder::setSubtitle)
        description?.let(builder::setDescription)
        when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
                builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
            Build.VERSION.SDK_INT == Build.VERSION_CODES.Q -> @Suppress("DEPRECATION") builder.setDeviceCredentialAllowed(true)
            else -> builder.setNegativeButton(context.getString(R.string.home_cancel), executor) { _, _ -> if (continuation.isActive) continuation.resume(false) }
        }
        val cancel = CancellationSignal()
        continuation.invokeOnCancellation { cancel.cancel() }
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                if (continuation.isActive) continuation.resume(true)
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                if (continuation.isActive) continuation.resume(false)
            }
        }
        // The prompt belongs to the main thread, whoever asked.
        executor.execute { builder.build().authenticate(cancel, executor, callback) }
    }
