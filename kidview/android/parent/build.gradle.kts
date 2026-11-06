import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Release signing: android/signing/keystore.properties on your PC (or KIDVIEW_* environment variables).
val signing = Properties().apply {
    rootProject.file("signing/keystore.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun signingValue(key: String, env: String): String? = signing.getProperty(key) ?: System.getenv(env)

android {
    namespace = "com.family.kidview.parent"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.thejumpvault.kidview.parent"
        minSdk = 26
        targetSdk = 36
        versionCode = providers.gradleProperty("VERSION_CODE").get().toInt()
        versionName = providers.gradleProperty("VERSION_NAME").get()
        // Where the apps look for new versions (latest.json). Set in gradle.properties by scripts/release.ps1.
        buildConfigField("String", "UPDATE_SITE", "\"${providers.gradleProperty("KIDVIEW_SITE").getOrElse("")}\"")
    }

    signingConfigs {
        create("release") {
            signingValue("storeFile", "KIDVIEW_KEYSTORE")?.let { storeFile = rootProject.file(it) }
            storePassword = signingValue("storePassword", "KIDVIEW_STORE_PASSWORD")
            keyAlias = signingValue("keyAlias", "KIDVIEW_KEY_ALIAS")
            keyPassword = signingValue("keyPassword", "KIDVIEW_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = if (signingValue("storeFile", "KIDVIEW_KEYSTORE") != null) signingConfigs.getByName("release")
                else signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

tasks.withType<KotlinCompile> {
    compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.coil.compose)
    implementation(libs.coil.network)
    implementation(libs.okhttp)
    implementation(libs.zxing.embedded)
}
