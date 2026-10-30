package com.oxespace.mobile.approval

import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import com.oxespace.mobile.R
import com.oxespace.mobile.protocol.RemotePendingRequest
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * The system's own prompt: strong biometrics or the device's PIN, pattern or password. With neither set up, or when
 * the person cancels, it answers false and nothing is sent. The framework prompt (API 28+) needs no extra library.
 */
class BiometricApprovalGate(private val context: Context) : ApprovalGate {
    override suspend fun confirm(request: RemotePendingRequest, decision: String?): Boolean = suspendCancellableCoroutine { continuation ->
        val executor = ContextCompat.getMainExecutor(context)
        val title = context.getString(
            when (decision) {
                "accept" -> R.string.approval_prompt_accept
                "decline" -> R.string.approval_prompt_decline
                "cancel" -> R.string.approval_prompt_cancel
                else -> R.string.approval_prompt_answer
            },
        )
        val builder = BiometricPrompt.Builder(context)
            .setTitle(title)
            .setSubtitle(request.threadTitle)
            .setDescription(request.title)
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
}
