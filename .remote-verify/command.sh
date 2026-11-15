cd mobile/android
exec ./gradlew --no-daemon --init-script "$GITHUB_WORKSPACE/.remote-verify/testlog.gradle" :protocol:test :app:testDebugUnitTest :app:lintDebug
