package com.oxespace.mobile

/**
 * 1.5.0 F10 CR-F10-9: an on-device test that only means something on the build that ships (the `minified` test build
 * type of the release workflow). The debug connected run leaves it out with the runner's `notAnnotation` argument
 * (app/build.gradle.kts), because a skipped assumption there is reported as a failure.
 */
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.FUNCTION, AnnotationTarget.CLASS)
annotation class ReleaseOnly
