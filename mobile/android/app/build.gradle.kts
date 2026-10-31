plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    // Screenshots of every screen in every state, light and dark, en and pt-BR (src/test/snapshots).
    alias(libs.plugins.paparazzi)
}

android {
    namespace = "com.oxespace.mobile"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.oxespace.mobile"
        minSdk = 28
        targetSdk = 37
        // The release workflow passes the tag's version; local builds stay at the default.
        versionName = providers.environmentVariable("ANDROID_VERSION_NAME").getOrElse("1.4.0")
        versionCode = versionCodeOf(versionName!!)
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Instrumented tests run on debug; the release workflow passes -Poxespace.testBuildType=minified to run the
    // release smoke test against the build R8 shrank.
    testBuildType = providers.gradleProperty("oxespace.testBuildType").getOrElse("debug")

    // Only on the release workflow, from repository secrets (RELEASING.md); the key is never in the repository.
    val keystore = providers.environmentVariable("ANDROID_KEYSTORE_PATH").orNull
    if (keystore != null) {
        signingConfigs.create("release") {
            storeFile = file(keystore)
            storePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").get()
            keyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").get()
            keyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").get()
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
        // The release build exactly as R8 shrinks it, signed with the debug key so the smoke test can be installed
        // beside it. Never published: the release workflow checks it before attaching the real APK.
        create("minified") {
            initWith(getByName("release"))
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
            proguardFile("minified-rules.pro")
            testProguardFiles("test-proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    lint {
        warningsAsErrors = true
        abortOnError = true
        checkDependencies = true
        // New library releases are taken on purpose, in their own PR, not because lint saw them.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        allWarningsAsErrors.set(true)
    }
}

dependencies {
    implementation(project(":protocol"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.zxing.core)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)

    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.okhttp.mockwebserver)
    androidTestImplementation(libs.okhttp.tls)
}

/** 1.4.0 → 10400, 1.12.3 → 11203: always grows with the version, as Android requires for updates. */
fun versionCodeOf(name: String): Int {
    val (major, minor, patch) = name.substringBefore('-').split('.').map { it.toInt() } + listOf(0, 0)
    return major * 10_000 + minor * 100 + patch
}
