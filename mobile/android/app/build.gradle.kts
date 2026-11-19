import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing comes from android/key.properties (local + CI) or ANDROID_* env
// vars. With neither present, release builds fall back to the debug key so a
// local `flutter build apk --release` still works. storeFile is relative to app/.
val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) FileInputStream(f).use { load(it) }
}

fun signingValue(prop: String, env: String): String? =
    (keystoreProperties.getProperty(prop) ?: System.getenv(env))?.takeIf { it.isNotBlank() }

val releaseStoreFile = signingValue("storeFile", "ANDROID_KEYSTORE_PATH")
val releaseStorePassword = signingValue("storePassword", "ANDROID_STORE_PASSWORD")
val releaseKeyAlias = signingValue("keyAlias", "ANDROID_KEY_ALIAS")
val releaseKeyPassword = signingValue("keyPassword", "ANDROID_KEY_PASSWORD")
val hasReleaseSigning =
    listOf(releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword).all { it != null } &&
        file(releaseStoreFile!!).exists()

// CI passes --build-number=<run_number>; FLUTTER_BUILD_NUMBER also overrides it,
// so each published APK installs as an update over the previous one.
val ciVersionCode = System.getenv("FLUTTER_BUILD_NUMBER")?.toIntOrNull()

android {
    namespace = "com.devcipator.chat_app"
    // permission_handler_android 14 compiles against (and requires) SDK 37.
    compileSdk = maxOf(flutter.compileSdkVersion, 37)
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.devcipator.chat_app"
        // agora_rtc_engine, record and permission_handler need API 24+.
        minSdk = maxOf(flutter.minSdkVersion, 24)
        targetSdk = flutter.targetSdkVersion
        // pubspec build number (or --build-number), unless FLUTTER_BUILD_NUMBER is set.
        versionCode = ciVersionCode ?: flutter.versionCode
        versionName = flutter.versionName
    }

    packaging {
        jniLibs {
            // Store native libraries compressed in the APK: a much smaller
            // download (they're extracted once at install time).
            useLegacyPackaging = true
            // Optional Agora extensions the app never enables (beauty, virtual
            // background, spatial audio, face/lip tracking, content
            // inspection, AV1, screen capture). Agora loads each one only when
            // its feature is turned on, so calls work without them. Remove a
            // line here before using that feature.
            excludes += listOf(
                "**/libagora_lip_sync_extension.so",
                "**/libagora_clear_vision_extension.so",
                "**/libagora_spatial_audio_extension.so",
                "**/libagora_face_capture_extension.so",
                "**/libagora_face_detection_extension.so",
                "**/libagora_segmentation_extension.so",
                "**/libagora_audio_beauty_extension.so",
                "**/libagora_content_inspect_extension.so",
                "**/libagora_video_quality_analyzer_extension.so",
                "**/libagora_video_av1_encoder_extension.so",
                "**/libagora_screen_capture_extension.so",
            )
        }
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                logger.warn("No release keystore (key.properties / ANDROID_* env): signing release with the debug key.")
                signingConfigs.getByName("debug")
            }
            // R8: strip unused Java/Kotlin code and unreferenced resources.
            // Keep rules for reflection/JNI users live in proguard-rules.pro.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
