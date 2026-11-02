# Only for the `minified` build type, which the smoke test runs against; the shipped release never reads this file.
# The instrumented-test APK runs inside the app's process and shares its Kotlin and AndroidX classes, so R8 must not
# trim those here (the runner needs androidx.tracing, and test lambdas need kotlin.jvm.internal.Lambda's constructor).
# What the smoke test is about still goes through R8 exactly as in the release: the app's and the protocol's code,
# kotlinx.serialization and OkHttp.
-keep class kotlin.** { *; }
-keep class androidx.** { *; }
# The smoke test's entry points into the protocol (it calls them directly, the app through its own code). The frames,
# their serializers and wire enums are kept by the protocol's own rules, exactly as in the release.
-keep class com.oxespace.mobile.protocol.RemoteFrames { *; }
-keep class com.oxespace.mobile.protocol.FrameRead** { *; }
-keep enum com.oxespace.mobile.protocol.FrameSource { *; }
# ReleaseSmokeTest checks that the shipped build ignores the debug-only pairing link.
-keep class com.oxespace.mobile.pairing.PairLinkForHomologation { *; }
-keep class com.oxespace.mobile.pairing.PairingViewModel { *; }
-keep class com.oxespace.mobile.pairing.PairingState** { *; }
# The smoke test asks the shrunk build whether captures can be allowed (they never can outside debug).
-keep class com.oxespace.mobile.ui.CaptureForHomologation { *; }
