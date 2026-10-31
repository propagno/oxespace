package com.oxespace.mobile.protocol.pairing

/**
 * The exact text a refresh signs (UTF-8), as `refreshSigningInput` in shared/remote/protocol.ts: bound to this
 * desktop's certificate, the device and the connection's `hello.challenge`, so a signature can't serve elsewhere.
 */
fun refreshSigningInput(fingerprint: String, deviceId: String, nonce: String): String =
    "oxespace-refresh:1:$fingerprint:$deviceId:$nonce"
