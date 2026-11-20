// Config plugin: release-APK shape for the Android build (applied at `expo prebuild`).
//
//  - One APK per CPU architecture (arm64-v8a primary, armeabi-v7a for older
//    phones) instead of a fat APK carrying every ABI's native libraries.
//  - Per-ABI versionCodes using the SAME formula the Flutter build used
//    (`flutter build apk --split-per-abi`: armeabi-v7a = 1000 + N,
//    arm64-v8a = 2000 + N, N = build number), so this APK installs as an
//    update over the existing Flutter app (live arm64 build: 2013).
//  - Release signing from android/key.properties or ANDROID_* env vars
//    (same files and secrets as before); falls back to the debug key locally.
//  - Optional Agora extensions the app never enables are left out (same list
//    the Flutter build excluded); Agora loads each one only when its feature
//    is turned on, so calls work without them.
const { withAppBuildGradle, withGradleProperties } = require("expo/config-plugins");

const MARKER = "// @chat-app/release-config";

const AGORA_UNUSED_EXTENSIONS = [
  "lip_sync",
  "clear_vision",
  "spatial_audio",
  "face_capture",
  "face_detection",
  "segmentation",
  "audio_beauty",
  "content_inspect",
  "video_quality_analyzer",
  "video_av1_encoder",
  "screen_capture",
];

const gradleBlock = `
${MARKER}
def chatKeystoreProps = new Properties()
def chatKeystoreFile = rootProject.file("key.properties")
if (chatKeystoreFile.exists()) { chatKeystoreFile.withInputStream { chatKeystoreProps.load(it) } }
def chatSigning = { String prop, String env ->
    def v = chatKeystoreProps.getProperty(prop) ?: System.getenv(env)
    return (v != null && !v.trim().isEmpty()) ? v.trim() : null
}
def chatStoreFile = chatSigning("storeFile", "ANDROID_KEYSTORE_PATH")
def chatStorePassword = chatSigning("storePassword", "ANDROID_STORE_PASSWORD")
def chatKeyAlias = chatSigning("keyAlias", "ANDROID_KEY_ALIAS")
def chatKeyPassword = chatSigning("keyPassword", "ANDROID_KEY_PASSWORD")
def chatHasReleaseSigning = [chatStoreFile, chatStorePassword, chatKeyAlias, chatKeyPassword].every { it != null } &&
    file(chatStoreFile).exists()

android {
    signingConfigs {
        if (chatHasReleaseSigning) {
            release {
                storeFile file(chatStoreFile)
                storePassword chatStorePassword
                keyAlias chatKeyAlias
                keyPassword chatKeyPassword
            }
        }
    }
    buildTypes {
        release {
            signingConfig chatHasReleaseSigning ? signingConfigs.release : signingConfigs.debug
        }
    }
    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "armeabi-v7a"
            universalApk false
        }
    }
    packagingOptions {
        jniLibs {
            // Compressed native libraries: a much smaller download.
            useLegacyPackaging true
            excludes += [${AGORA_UNUSED_EXTENSIONS.map((e) => `"**/libagora_${e}_extension.so"`).join(", ")}]
        }
    }
}

// Flutter's --split-per-abi versionCode scheme: abi * 1000 + build number.
def chatAbiCodes = ["armeabi-v7a": 1, "arm64-v8a": 2, "x86": 3, "x86_64": 4]
androidComponents {
    onVariants(selector().all()) { variant ->
        variant.outputs.each { output ->
            def abiFilter = output.filters.find { it.filterType.name() == "ABI" }
            def abiCode = abiFilter ? chatAbiCodes[abiFilter.identifier] : null
            if (abiCode != null) {
                output.versionCode.set(abiCode * 1000 + (output.versionCode.getOrElse(1) as int))
            }
        }
    }
}
`;

module.exports = function withAndroidRelease(config) {
  config = withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += `\n${gradleBlock}`;
    }
    return cfg;
  });
  config = withGradleProperties(config, (cfg) => {
    const set = (key, value) => {
      cfg.modResults = cfg.modResults.filter((p) => !(p.type === "property" && p.key === key));
      cfg.modResults.push({ type: "property", key, value });
    };
    // Only compile native code for the ABIs we ship (faster CI, nothing for x86).
    set("reactNativeArchitectures", "armeabi-v7a,arm64-v8a");
    return cfg;
  });
  return config;
};
