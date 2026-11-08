import java.io.File
import java.util.Properties

import org.gradle.api.tasks.Copy
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ── 版本号唯一真相源 ──
// 改版本只改 appVersionName 这一行：versionCode 与 BuildConfig.APP_VERSION 均由此派生。
val appVersionName = "2.0.0"
val appVersionBase = appVersionName.substringBefore('-').substringBefore('+')
val parts = appVersionBase.split(".").map { it.toIntOrNull() ?: error("versionName 非法：$appVersionName") }
require(parts.size == 3) { "versionName 必须是 major.minor.patch[-suffix]：$appVersionName" }
val appVersionCode = parts[0] * 10000 + parts[1] * 100 + parts[2]
val expectedVersion = (findProperty("expectedVersion") as String?)?.trim().orEmpty()
require(expectedVersion.isEmpty() || expectedVersion == appVersionName) { "tag 版本 $expectedVersion 与 versionName $appVersionName 不一致" }

android {
    namespace = "top.crazying.forum"
    compileSdk = 36

    defaultConfig {
        applicationId = "top.crazying.forum"
        minSdk = 24
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
        buildConfigField("String", "APP_VERSION", "\"$appVersionName\"")
        resourceConfigurations += listOf("zh", "en")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // APP 专用零 PoW 通道密钥（与后端 ALTCHA_APP_SECRET 一致）。
        val altchaAppSecret = ((findProperty("altchaAppSecret") as String?)
            ?: System.getenv("ALTCHA_APP_SECRET")).orEmpty().trim()
        require(altchaAppSecret.all { it.code in 0x21..0x7e }) {
            "altchaAppSecret 只能是可见 ASCII（建议 openssl rand -hex 32）"
        }
        buildConfigField("String", "ALTCHA_APP_SECRET", "\"$altchaAppSecret\"")
    }

    // 发布签名：环境变量优先（CI 注入），仓库根 keystore.properties 兜底。
    val keystorePropsFile = rootProject.file("keystore.properties")
    val keystoreProps = Properties().apply {
        if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
    }
    val releaseStoreFileRaw = System.getenv("ANDROID_KEYSTORE_FILE")?.trim()?.takeIf { it.isNotEmpty() }
        ?: keystoreProps.getProperty("storeFile")
    val releaseStorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")?.trim()?.takeIf { it.isNotEmpty() }
        ?: keystoreProps.getProperty("storePassword")
    val releaseKeyAlias = System.getenv("ANDROID_KEY_ALIAS")?.trim()?.takeIf { it.isNotEmpty() }
        ?: keystoreProps.getProperty("keyAlias")
    val releaseKeyPassword = System.getenv("ANDROID_KEY_PASSWORD")?.trim()?.takeIf { it.isNotEmpty() }
        ?: keystoreProps.getProperty("keyPassword")
    val releaseStoreFile = releaseStoreFileRaw?.trim()?.takeIf { it.isNotEmpty() }?.let { path ->
        if (File(path).isAbsolute) File(path) else rootProject.file(path)
    }
    val hasReleaseKey = releaseStoreFile?.exists() == true &&
        !releaseStorePassword.isNullOrBlank() &&
        !releaseKeyAlias.isNullOrBlank() &&
        !releaseKeyPassword.isNullOrBlank()

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            // 开发期默认指向本地 ouo（模拟器 10.0.2.2）；真机可用 -PapiBaseUrl 覆盖。
            val debugApi = (findProperty("apiBaseUrl") as String?)?.trim().orEmpty()
                .ifBlank { "http://10.0.2.2:8090" }
            buildConfigField("String", "API_BASE_URL", "\"$debugApi\"")
        }
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            val releaseApi = (findProperty("apiBaseUrl") as String?)?.trim().orEmpty()
                .ifBlank { "https://www.yjlt.top" }
            buildConfigField("String", "API_BASE_URL", "\"$releaseApi\"")
            if (hasReleaseKey) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
}

// 把 web/dist 同步到 Capacitor 的本地资源目录。
// 本地开发：先 cd web && pnpm install && pnpm build；CI 已在前置步骤完成。
val webDistDir = rootProject.file("web/dist")
val syncWebAssets = tasks.register<Copy>("syncWebAssets") {
    from(webDistDir)
    into(layout.projectDirectory.dir("src/main/assets/public"))
    doFirst {
        check(webDistDir.resolve("index.html").exists()) {
            "web/dist/index.html 不存在：请先执行 cd web && pnpm install && pnpm build"
        }
    }
}
tasks.named("preBuild") { dependsOn(syncWebAssets) }

dependencies {
    // Capacitor 原生运行时（Maven Central 坐标，见 Phase 0 spike）
    implementation("com.capacitorjs:core:8.5.3")

    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    implementation("com.squareup.okhttp3:okhttp:5.0.0")
    implementation("com.squareup.okhttp3:okhttp-sse:5.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
