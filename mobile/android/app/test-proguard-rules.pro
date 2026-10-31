# Rules for the instrumented-test APK of the `minified` build type only (never part of the app).
# okhttp-tls, used by the tests' fake gateway, references a build-time annotation that isn't shipped.
-dontwarn org.codehaus.mojo.animal_sniffer.IgnoreJRERequirement
# The runner finds tests by class and method name: keep them as written, or a filtered run finds none.
-keep @org.junit.runner.RunWith class * { *; }
