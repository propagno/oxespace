cd mobile/android
exec ./gradlew --no-daemon --init-script "$GITHUB_WORKSPACE/.remote-verify/testlog.gradle" :app:testDebugUnitTest --tests '*SettingsSectionsTest*' --tests '*SettingsSectionsGuardTest*'
