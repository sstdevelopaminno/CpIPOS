plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val releaseKeystorePath = System.getenv("CPIPOS_ANDROID_KEYSTORE_PATH")
val releaseStorePassword = System.getenv("CPIPOS_ANDROID_STORE_PASSWORD")
val releaseKeyAlias = System.getenv("CPIPOS_ANDROID_KEY_ALIAS")
val releaseKeyPassword = System.getenv("CPIPOS_ANDROID_KEY_PASSWORD")
val releaseSigningReady = listOf(
    releaseKeystorePath,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword
).all { !it.isNullOrBlank() }

android {
    namespace = "com.cpipos.pos"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.cpipos.pos"
        minSdk = 26
        targetSdk = 34
        versionCode = 17
        versionName = "1.0.11"

        buildConfigField("String", "CPIPOS_API_BASE_URL", "\"https://cp-ipos-web.vercel.app\"")
        buildConfigField("String", "CPIPOS_POS_WEB_URL", "\"https://cp-ipos-web.vercel.app/login/store\"")
        buildConfigField("String", "CPIPOS_MDM_HEARTBEAT_URL", "\"https://cp-ipos-web.vercel.app/api/android-pos/mdm/heartbeat\"")
        buildConfigField("String", "CPIPOS_ANDROID_POS_ALLOWED_HOST", "\"cp-ipos-web.vercel.app\"")
    }

    signingConfigs {
        if (releaseSigningReady) {
            create("release") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseSigningReady) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.06.00")

    implementation(composeBom)
    androidTestImplementation(composeBom)

    testImplementation("junit:junit:4.13.2")

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.3")

    // MobileApp.kt uses Foundation layouts/lists/gestures and Material 3 controls directly.
    // Keep all Compose artifacts on the BOM so Kotlin/Compose versions stay aligned in CI and release builds.
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
